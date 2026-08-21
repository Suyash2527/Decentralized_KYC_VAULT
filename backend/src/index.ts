import 'dotenv/config';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { checkStatusOnChain, grantConsentOnChain, normalizePartnerId, revokeConsentOnChain, verifyKYCOnChain } from './services/blockchain';
import { hashData, openPII, sealPII } from './utils/crypto';
import { assertKmsReachable } from './services/kms';
import { getOperatorAddress } from './services/blockchain';
import { hashPassword, verifyPassword } from './utils/password';

type AppRole = 'VERIFIER' | 'CUSTOMER' | 'PARTNER';
type DisclosureType = 'FULL' | 'NAME_ONLY' | 'PROOF_OF_EXISTENCE';

interface AuthUser {
    username: string;
    role: AppRole;
    bankId: string;
}

interface AuthenticatedRequest extends Request {
    user: AuthUser;
}

type AccessChannel = 'CONSENT' | 'OTP';
type AccessOutcome = 'GRANTED' | 'DENIED';

const app = express();
const prisma = new PrismaClient();

// Cloud Run terminates TLS upstream, so the client IP the rate limiter keys on
// only arrives via X-Forwarded-For.
app.set('trust proxy', 1);

const corsOrigins = process.env.CORS_ORIGIN
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);

app.use(helmet());
app.use(cors(corsOrigins && corsOrigins.length > 0 ? { origin: corsOrigins } : undefined));
app.use(express.json());

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Try again later.' }
});

// The per-challenge attempt counter caps guesses against one OTP; this caps an
// attacker cycling through fresh challenges to get unlimited guesses overall.
const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many OTP attempts. Try again later.' }
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
        const allowedMimeTypes = new Set([
            'application/pdf',
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/webp'
        ]);

        if (!allowedMimeTypes.has(file.mimetype)) {
            callback(new Error('Only PDF and image uploads are supported.'));
            return;
        }

        callback(null, true);
    }
});

const allowedRoles = new Set<AppRole>(['VERIFIER', 'CUSTOMER', 'PARTNER']);
const allowedDisclosureTypes = new Set<DisclosureType>(['FULL', 'NAME_ONLY', 'PROOF_OF_EXISTENCE']);

const JWT_SECRET = process.env.JWT_SECRET ?? '';

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required.');
}

const OCR_API_KEY = process.env.GCP_API_KEY;
const OTP_MAX_ATTEMPTS = 5;
const OTP_TTL_MS = 5 * 60 * 1000;
const SELF_DESTRUCT_SWEEP_MS = 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;

function normalizeIdentifier(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeRole(value: unknown): AppRole | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalizedRole = value.trim().toUpperCase() as AppRole;
    return allowedRoles.has(normalizedRole) ? normalizedRole : null;
}

function normalizeDisclosureType(value: unknown): DisclosureType {
    if (typeof value !== 'string') {
        return 'FULL';
    }

    const normalized = value.trim().toUpperCase() as DisclosureType;
    return allowedDisclosureTypes.has(normalized) ? normalized : 'FULL';
}

function signToken(user: AuthUser): string {
    return jwt.sign(user, JWT_SECRET, { expiresIn: '2h' });
}

function hashOtp(customerId: string, partnerId: string, otp: string, salt: string): string {
    return hashData(`${customerId}:${normalizePartnerId(partnerId)}:${salt}:${otp}`);
}

async function clearOtpChallengesForCustomer(customerId: string) {
    await prisma.otpChallenge.deleteMany({ where: { customerId } });
}

// Access logging must never take down the request that triggered it — a failed
// audit write is reported, not propagated to the caller.
async function recordAccess(entry: {
    customerId: string;
    partnerId: string;
    channel: AccessChannel;
    outcome: AccessOutcome;
    disclosureType: DisclosureType | 'NONE';
    reason?: string;
}) {
    try {
        await prisma.accessLog.create({ data: { ...entry, reason: entry.reason ?? null } });
    } catch (error) {
        console.error('Failed to write access log.', error);
    }
}

function buildAuditEvent(type: string, title: string, description: string, timestamp: Date, partnerId?: string) {
    return {
        type,
        title,
        description,
        timestamp,
        partnerId: partnerId || null
    };
}

function handleServerError(res: Response, message: string, error: unknown) {
    console.error(message, error);
    res.status(500).json({ error: message });
}

async function resolvePartnerAccount(partnerReference: string) {
    const normalizedReference = normalizeIdentifier(partnerReference);

    if (!normalizedReference) {
        return null;
    }

    return prisma.bankUser.findFirst({
        where: {
            role: 'PARTNER',
            OR: [
                { username: { equals: normalizedReference, mode: 'insensitive' } },
                { bankId: { equals: normalizedReference, mode: 'insensitive' } }
            ]
        }
    });
}

async function ensureCustomerRecord(customerId: string) {
    return prisma.customer.findUnique({ where: { publicId: customerId } });
}

const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        res.sendStatus(401);
        return;
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err || !decoded || typeof decoded === 'string') {
            res.sendStatus(403);
            return;
        }

        const user = decoded as AuthUser;
        (req as AuthenticatedRequest).user = user;
        next();
    });
};

const selfDestructSweep = setInterval(async () => {
    try {
        const expiredCustomers = await prisma.customer.findMany({
            where: {
                expiresAt: { lt: new Date() }
            }
        });

        for (const customer of expiredCustomers) {
            await clearOtpChallengesForCustomer(customer.publicId);
            await prisma.$transaction([
                prisma.consent.deleteMany({ where: { customerId: customer.publicId } }),
                prisma.customer.delete({ where: { id: customer.id } })
            ]);
        }

        await prisma.otpChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    } catch (error) {
        console.error('Self-destruct sweep failed.', error);
    }
}, SELF_DESTRUCT_SWEEP_MS);

app.post('/api/auth/register', authLimiter, async (req, res) => {
    const username = normalizeIdentifier(req.body.username);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const role = normalizeRole(req.body.role);
    const registrationCode = normalizeIdentifier(req.body.registrationCode);

    if (!username || !role) {
        res.status(400).json({ error: 'Username and a supported role are required.' });
        return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
        return;
    }

    if (role !== 'CUSTOMER') {
        const requiredCode = role === 'VERIFIER'
            ? process.env.VERIFIER_REGISTRATION_CODE
            : process.env.PARTNER_REGISTRATION_CODE;

        if (!requiredCode || registrationCode !== requiredCode) {
            res.status(403).json({ error: `${role} accounts must be provisioned by an administrator.` });
            return;
        }
    }

    try {
        const existingUser = await prisma.bankUser.findUnique({ where: { username } });

        if (existingUser) {
            res.status(400).json({ error: 'Username already taken.' });
            return;
        }

        const passwordHash = await hashPassword(password);
        const bankId = username;
        const user = await prisma.bankUser.create({
            data: {
                username,
                passwordHash,
                role,
                bankId
            }
        });

        const authUser: AuthUser = { username: user.username, role: user.role as AppRole, bankId: user.bankId };
        res.json({ token: signToken(authUser), user: authUser });
    } catch (error) {
        handleServerError(res, 'Unable to register account.', error);
    }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
    const username = normalizeIdentifier(req.body.username);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    try {
        const user = await prisma.bankUser.findUnique({ where: { username } });

        if (!user) {
            res.status(401).json({ error: 'Invalid credentials.' });
            return;
        }

        const passwordCheck = await verifyPassword(password, user.passwordHash);

        if (!passwordCheck.valid) {
            res.status(401).json({ error: 'Invalid credentials.' });
            return;
        }

        if (passwordCheck.needsRehash) {
            await prisma.bankUser.update({
                where: { id: user.id },
                data: { passwordHash: await hashPassword(password) }
            });
        }

        const authUser: AuthUser = { username: user.username, role: user.role as AppRole, bankId: user.bankId };
        res.json({ token: signToken(authUser), user: authUser });
    } catch (error) {
        handleServerError(res, 'Unable to log in.', error);
    }
});

app.post('/api/ocr/extract', authenticateToken, upload.single('document'), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;

    if (authReq.user.role !== 'VERIFIER') {
        res.status(403).json({ error: 'Unauthorized role.' });
        return;
    }

    if (!OCR_API_KEY) {
        res.status(503).json({ error: 'OCR is not configured on the server.' });
        return;
    }

    if (!req.file) {
        res.status(400).json({ error: 'No document uploaded.' });
        return;
    }

    try {
        const base64Image = req.file.buffer.toString('base64');
        const visionPayload = {
            requests: [
                {
                    image: { content: base64Image },
                    features: [{ type: 'TEXT_DETECTION', maxResults: 1 }]
                }
            ]
        };

        const visionResponse = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${OCR_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(visionPayload)
        });

        if (!visionResponse.ok) {
            res.status(502).json({ error: 'OCR provider rejected the request.' });
            return;
        }

        const visionData = await visionResponse.json() as {
            error?: { message?: string };
            responses?: Array<{ textAnnotations?: Array<{ description?: string }> }>;
        };

        if (visionData.error) {
            res.status(502).json({ error: visionData.error.message || 'OCR provider returned an error.' });
            return;
        }

        const rawText = visionData.responses?.[0]?.textAnnotations?.[0]?.description || '';
        const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean);
        let fullName = '';
        let govId = '';
        let dob = '';

        const aadhaarMatch = rawText.match(/\d{4}\s?\d{4}\s?\d{4}/);
        if (aadhaarMatch) {
            govId = aadhaarMatch[0];
        }

        const panMatch = rawText.match(/[A-Z]{5}\d{4}[A-Z]/);
        if (panMatch && !govId) {
            govId = panMatch[0];
        }

        const dobMatch = rawText.match(/(\d{2}[/-]\d{2}[/-]\d{4})/);
        if (dobMatch) {
            dob = dobMatch[1];
        }

        // Strategy 1: Look for "Name" (PAN Cards)
        for (let i = 0; i < lines.length; i++) {
            const lowerLine = lines[i].toLowerCase();
            if ((lowerLine === 'name' || lowerLine === 'name:') && i + 1 < lines.length) {
                const candidate = lines[i + 1].replace(/[^A-Za-z\s]/g, '').trim();
                if (candidate && candidate.length > 2) {
                    fullName = candidate;
                    break;
                }
            }
        }

        // Strategy 2: Look immediately above DOB (Aadhaar Cards)
        if (!fullName) {
            for (let i = 0; i < lines.length; i++) {
                const lowerLine = lines[i].toLowerCase();
                if (lowerLine.includes('dob') || lowerLine.includes('birth') || lowerLine.includes('year of')) {
                    // Check up to 3 lines above DOB for the English name
                    for (let j = 1; j <= 3; j++) {
                        if (i - j >= 0) {
                            const candidate = lines[i - j].replace(/[^A-Za-z\s]/g, '').trim();
                            const words = candidate.split(/\s+/).length;
                            // Valid name: 2-4 words, English letters, not boilerplate
                            if (
                                candidate.length > 3 &&
                                words >= 2 && words <= 4 &&
                                !candidate.toLowerCase().includes('government') &&
                                !candidate.toLowerCase().includes('india')
                            ) {
                                fullName = candidate;
                                break;
                            }
                        }
                    }
                    if (fullName) break;
                }
            }
        }

        // Strategy 3: Generic Fallback (Find first clean English name)
        if (!fullName) {
            const ignoreWords = ['government', 'india', 'father', 'dob', 'year', 'birth', 'male', 'female', 'address', 'enrolment', 'enrollment', 'unique', 'authority', 'signature', 'validity', 'vid', 'card', 'identity', 'national', 'republic', 'state', 'department', 'income', 'tax', 'permanent', 'account', 'number', 'establish', 'proof'];
            for (const line of lines) {
                const cleaned = line.replace(/[^A-Za-z\s]/g, '').trim();
                const lowerCleaned = cleaned.toLowerCase();
                const wordCount = cleaned.split(/\s+/).length;
                
                if (
                    cleaned.length > 4 &&
                    wordCount >= 2 &&
                    wordCount <= 4 &&
                    !ignoreWords.some(w => lowerCleaned.includes(w))
                ) {
                    fullName = cleaned;
                    break;
                }
            }
        }

        res.json({
            success: true,
            extracted: { fullName, govId, dob },
            rawText
        });
    } catch (error) {
        handleServerError(res, 'Unable to process OCR extraction.', error);
    }
});

app.post('/api/kyc/verify', authenticateToken, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;

    if (authReq.user.role !== 'VERIFIER') {
        res.status(403).json({ error: 'Unauthorized role.' });
        return;
    }

    const customerId = normalizeIdentifier(req.body.customerId);
    const pii = req.body.pii;
    const fullName = normalizeIdentifier(pii?.fullName);
    const govId = normalizeIdentifier(pii?.govId);

    if (!customerId || !fullName) {
        res.status(400).json({ error: 'Customer ID and full name are required.' });
        return;
    }

    try {
        const piiPayload = JSON.stringify({ fullName, govId });
        const piiHash = hashData(piiPayload);

        // The customer's publicId is the encryption context: it binds this
        // record's wrapped data key to this row, so a wrapped key copied onto
        // another customer's row will not unwrap.
        const { payload: encryptedPII, kmsKeyVersion } = await sealPII(piiPayload, customerId);
        const txHash = await verifyKYCOnChain(customerId, `0x${piiHash}`);

        await prisma.customer.upsert({
            where: { publicId: customerId },
            update: { encryptedPII, piiHash, kmsKeyVersion, expiresAt: null },
            create: { publicId: customerId, encryptedPII, piiHash, kmsKeyVersion }
        });

        res.json({ success: true, txHash, piiHash });
    } catch (error) {
        handleServerError(res, 'Unable to verify KYC on-chain.', error);
    }
});

app.post('/api/consent/grant', authenticateToken, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;

    if (authReq.user.role !== 'CUSTOMER') {
        res.status(403).json({ error: 'Unauthorized role.' });
        return;
    }

    const customerId = authReq.user.bankId;
    const partnerReference = normalizeIdentifier(req.body.partnerId);

    if (!partnerReference) {
        res.status(400).json({ error: 'Partner ID is required.' });
        return;
    }

    try {
        const [customer, partner] = await Promise.all([
            ensureCustomerRecord(customerId),
            resolvePartnerAccount(partnerReference)
        ]);

        if (!customer) {
            res.status(404).json({ error: 'No verified customer record exists yet.' });
            return;
        }

        if (!partner) {
            res.status(404).json({ error: 'Partner account not found.' });
            return;
        }

        const txHash = await grantConsentOnChain(customerId, partner.bankId);

        await prisma.consent.upsert({
            where: { customerId_partnerId: { customerId, partnerId: partner.bankId } },
            update: { status: 'GRANTED' },
            create: { customerId, partnerId: partner.bankId, status: 'GRANTED' }
        });

        res.json({ success: true, txHash, partnerId: partner.bankId });
    } catch (error) {
        handleServerError(res, 'Unable to grant consent.', error);
    }
});

app.post('/api/consent/revoke', authenticateToken, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;

    if (authReq.user.role !== 'CUSTOMER') {
        res.status(403).json({ error: 'Unauthorized role.' });
        return;
    }

    const customerId = authReq.user.bankId;
    const partnerReference = normalizeIdentifier(req.body.partnerId);

    if (!partnerReference) {
        res.status(400).json({ error: 'Partner ID is required.' });
        return;
    }

    try {
        const [customer, partner] = await Promise.all([
            ensureCustomerRecord(customerId),
            resolvePartnerAccount(partnerReference)
        ]);

        if (!customer) {
            res.status(404).json({ error: 'No verified customer record exists yet.' });
            return;
        }

        if (!partner) {
            res.status(404).json({ error: 'Partner account not found.' });
            return;
        }

        const txHash = await revokeConsentOnChain(customerId, partner.bankId);

        await prisma.consent.upsert({
            where: { customerId_partnerId: { customerId, partnerId: partner.bankId } },
            update: { status: 'REVOKED' },
            create: { customerId, partnerId: partner.bankId, status: 'REVOKED' }
        });

        res.json({ success: true, txHash, partnerId: partner.bankId });
    } catch (error) {
        handleServerError(res, 'Unable to revoke consent.', error);
    }
});

app.get('/api/kyc/access/:customerId', authenticateToken, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;

    if (authReq.user.role !== 'PARTNER') {
        res.status(403).json({ error: 'Unauthorized role.' });
        return;
    }

    const customerId = normalizeIdentifier(req.params.customerId);

    if (!customerId) {
        res.status(400).json({ error: 'Customer ID is required.' });
        return;
    }

    const partnerId = normalizePartnerId(authReq.user.bankId);
    const denyAccess = async (statusCode: number, reason: string) => {
        await recordAccess({
            customerId,
            partnerId,
            channel: 'CONSENT',
            outcome: 'DENIED',
            disclosureType: 'NONE',
            reason
        });
        res.status(statusCode).json({ error: reason });
    };

    try {
        const status = await checkStatusOnChain(customerId, authReq.user.bankId);

        if (!status.isVerified) {
            await denyAccess(404, 'No verified on-chain KYC proof found.');
            return;
        }

        if (!status.hasConsent) {
            await denyAccess(403, 'Access denied: no active consent found.');
            return;
        }

        const customer = await ensureCustomerRecord(customerId);

        if (!customer) {
            await denyAccess(404, 'Data not found in secure storage.');
            return;
        }

        const decryptedString = await openPII(customer.encryptedPII, customerId);
        const currentHash = `0x${hashData(decryptedString)}`.toLowerCase();

        if (currentHash !== status.payloadHash) {
            await denyAccess(500, 'Data integrity verification failed.');
            return;
        }

        await recordAccess({
            customerId,
            partnerId,
            channel: 'CONSENT',
            outcome: 'GRANTED',
            disclosureType: 'FULL'
        });

        res.json({
            success: true,
            pii: JSON.parse(decryptedString),
            verifiedAt: new Date(status.verifiedAt * 1000).toISOString(),
            verifiedAtUnix: status.verifiedAt
        });
    } catch (error) {
        handleServerError(res, 'Unable to retrieve customer data.', error);
    }
});

// Lets the customer see what is actually in their own vault. Until now only
// PARTNER accounts could read PII, so the owner was the one role that could not
// see their own record.
app.get('/api/kyc/me', authenticateToken, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;

    if (authReq.user.role !== 'CUSTOMER') {
        res.status(403).json({ error: 'Unauthorized role.' });
        return;
    }

    const customerId = authReq.user.bankId;

    try {
        const customer = await ensureCustomerRecord(customerId);

        if (!customer) {
            res.json({ success: true, verified: false, pii: null, consents: [] });
            return;
        }

        const [status, consents] = await Promise.all([
            // Consent is irrelevant here; this call is only used for the
            // verification proof, which is not partner-specific.
            checkStatusOnChain(customerId, customerId),
            prisma.consent.findMany({ where: { customerId }, orderBy: { updatedAt: 'desc' } })
        ]);

        const decryptedString = await openPII(customer.encryptedPII, customerId);
        const currentHash = `0x${hashData(decryptedString)}`.toLowerCase();

        res.json({
            success: true,
            verified: status.isVerified,
            integrityOk: status.isVerified ? currentHash === status.payloadHash : null,
            pii: JSON.parse(decryptedString),
            piiHash: `0x${customer.piiHash}`,
            verifiedAt: status.isVerified ? new Date(status.verifiedAt * 1000).toISOString() : null,
            verifierBank: status.isVerified ? status.verifierBank : null,
            expiresAt: customer.expiresAt,
            consents: consents.map((consent) => ({
                partnerId: consent.partnerId,
                status: consent.status,
                updatedAt: consent.updatedAt
            }))
        });
    } catch (error) {
        handleServerError(res, 'Unable to load your identity record.', error);
    }
});

// Backs the partner picker, replacing free-text entry that failed on typos.
app.get('/api/partners', authenticateToken, async (_req: Request, res: Response) => {
    try {
        const partners = await prisma.bankUser.findMany({
            where: { role: 'PARTNER' },
            select: { username: true, bankId: true },
            orderBy: { username: 'asc' }
        });

        res.json({ success: true, partners });
    } catch (error) {
        handleServerError(res, 'Unable to load partner accounts.', error);
    }
});

app.get('/api/audit/:customerId', authenticateToken, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const customerId = normalizeIdentifier(req.params.customerId);

    if (authReq.user.role !== 'CUSTOMER' || authReq.user.bankId !== customerId) {
        res.status(403).json({ error: 'You can only access your own audit trail.' });
        return;
    }

    try {
        const [consents, customer, accessLogs] = await Promise.all([
            prisma.consent.findMany({
                where: { customerId },
                orderBy: { updatedAt: 'desc' }
            }),
            ensureCustomerRecord(customerId),
            prisma.accessLog.findMany({
                where: { customerId },
                orderBy: { createdAt: 'desc' },
                take: 200
            })
        ]);

        const auditTrail: Array<ReturnType<typeof buildAuditEvent> & { hash?: string | null }> = [];

        if (customer) {
            auditTrail.push({
                ...buildAuditEvent(
                    'KYC_VERIFIED',
                    'KYC identity verified',
                    'Encrypted PII was stored off-chain and the payload hash was anchored on-chain.',
                    customer.createdAt
                ),
                hash: customer.piiHash ? `0x${customer.piiHash.slice(0, 16)}...` : null
            });
        }

        for (const consent of consents) {
            auditTrail.push({
                ...buildAuditEvent(
                    consent.status === 'GRANTED' ? 'CONSENT_GRANTED' : 'CONSENT_REVOKED',
                    consent.status === 'GRANTED'
                        ? `Access granted to ${consent.partnerId}`
                        : `Access revoked from ${consent.partnerId}`,
                    consent.status === 'GRANTED'
                        ? `Your account approved ${consent.partnerId} to access your verified record.`
                        : `Your account removed ${consent.partnerId}'s access to your verified record.`,
                    consent.updatedAt,
                    consent.partnerId
                ),
                hash: null
            });
        }

        for (const log of accessLogs) {
            const viaOtp = log.channel === 'OTP';
            const granted = log.outcome === 'GRANTED';

            auditTrail.push({
                ...buildAuditEvent(
                    granted ? 'ACCESS_GRANTED' : 'ACCESS_DENIED',
                    granted
                        ? `${log.partnerId} read your record`
                        : `${log.partnerId} was denied access`,
                    granted
                        ? `Disclosed via ${viaOtp ? 'one-time password' : 'standing consent'} at the ${log.disclosureType} level.`
                        : `Attempted access via ${viaOtp ? 'one-time password' : 'standing consent'} was blocked. ${log.reason ?? ''}`.trim(),
                    log.createdAt,
                    log.partnerId
                ),
                hash: null
            });
        }

        auditTrail.sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());

        res.json({
            success: true,
            customerId,
            auditTrail,
            expiresAt: customer?.expiresAt || null
        });
    } catch (error) {
        handleServerError(res, 'Unable to load the audit trail.', error);
    }
});

app.post('/api/otp/generate', authenticateToken, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;

    if (authReq.user.role !== 'CUSTOMER') {
        res.status(403).json({ error: 'Unauthorized role.' });
        return;
    }

    const customerId = authReq.user.bankId;
    const disclosureType = normalizeDisclosureType(req.body.disclosureType);
    const partnerReference = normalizeIdentifier(req.body.partnerId);

    if (!partnerReference) {
        res.status(400).json({ error: 'Partner ID is required for OTP sharing.' });
        return;
    }

    try {
        const [customer, partner] = await Promise.all([
            ensureCustomerRecord(customerId),
            resolvePartnerAccount(partnerReference)
        ]);

        if (!customer) {
            res.status(404).json({ error: 'No verified customer record exists yet.' });
            return;
        }

        if (!partner) {
            res.status(404).json({ error: 'Partner account not found.' });
            return;
        }

        const otp = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
        const salt = crypto.randomBytes(16).toString('hex');
        const partnerId = normalizePartnerId(partner.bankId);

        const challenge = {
            attemptsRemaining: OTP_MAX_ATTEMPTS,
            disclosureType,
            expiresAt: new Date(Date.now() + OTP_TTL_MS),
            otpHash: hashOtp(customerId, partnerId, otp, salt),
            salt
        };

        await prisma.otpChallenge.upsert({
            where: { customerId_partnerId: { customerId, partnerId } },
            update: challenge,
            create: { customerId, partnerId, ...challenge }
        });

        res.json({
            success: true,
            otp,
            expiresInSeconds: OTP_TTL_MS / 1000,
            partnerId
        });
    } catch (error) {
        handleServerError(res, 'Unable to generate an OTP.', error);
    }
});

app.post('/api/otp/verify', authenticateToken, otpLimiter, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;

    if (authReq.user.role !== 'PARTNER') {
        res.status(403).json({ error: 'Unauthorized role.' });
        return;
    }

    const customerId = normalizeIdentifier(req.body.customerId);
    const otp = normalizeIdentifier(req.body.otp);
    const partnerId = normalizePartnerId(authReq.user.bankId);

    if (!customerId || !/^\d{6}$/.test(otp)) {
        res.status(400).json({ error: 'Customer ID and a valid 6-digit OTP are required.' });
        return;
    }

    const otpWhere = { customerId_partnerId: { customerId, partnerId } };
    const record = await prisma.otpChallenge.findUnique({ where: otpWhere });

    if (!record) {
        await recordAccess({
            customerId,
            partnerId,
            channel: 'OTP',
            outcome: 'DENIED',
            disclosureType: 'NONE',
            reason: 'No active OTP challenge.'
        });
        res.status(404).json({ error: 'No active OTP exists for this customer and partner.' });
        return;
    }

    if (Date.now() > record.expiresAt.getTime()) {
        await prisma.otpChallenge.delete({ where: otpWhere });
        await recordAccess({
            customerId,
            partnerId,
            channel: 'OTP',
            outcome: 'DENIED',
            disclosureType: 'NONE',
            reason: 'OTP expired.'
        });
        res.status(401).json({ error: 'OTP has expired. Ask the customer to generate a new one.' });
        return;
    }

    const expectedHash = hashOtp(customerId, partnerId, otp, record.salt);
    if (expectedHash !== record.otpHash) {
        const attemptsRemaining = record.attemptsRemaining - 1;

        await recordAccess({
            customerId,
            partnerId,
            channel: 'OTP',
            outcome: 'DENIED',
            disclosureType: 'NONE',
            reason: 'Incorrect OTP.'
        });

        if (attemptsRemaining <= 0) {
            await prisma.otpChallenge.delete({ where: otpWhere });
            res.status(429).json({ error: 'OTP verification attempts exhausted. Ask for a new OTP.' });
            return;
        }

        await prisma.otpChallenge.update({ where: otpWhere, data: { attemptsRemaining } });
        res.status(400).json({ error: `Invalid OTP. ${attemptsRemaining} attempts remaining.` });
        return;
    }

    try {
        const [customer, status] = await Promise.all([
            ensureCustomerRecord(customerId),
            checkStatusOnChain(customerId, authReq.user.bankId)
        ]);

        const disclosureType = normalizeDisclosureType(record.disclosureType);

        if (!customer) {
            await recordAccess({
                customerId,
                partnerId,
                channel: 'OTP',
                outcome: 'DENIED',
                disclosureType: 'NONE',
                reason: 'Customer data not found in the vault.'
            });
            res.status(404).json({ error: 'Customer data not found in the vault.' });
            return;
        }

        if (!status.isVerified) {
            await recordAccess({
                customerId,
                partnerId,
                channel: 'OTP',
                outcome: 'DENIED',
                disclosureType: 'NONE',
                reason: 'No verified on-chain KYC proof found.'
            });
            res.status(404).json({ error: 'No verified on-chain KYC proof found.' });
            return;
        }

        const decryptedString = await openPII(customer.encryptedPII, customerId);
        const currentHash = `0x${hashData(decryptedString)}`.toLowerCase();

        if (currentHash !== status.payloadHash) {
            await recordAccess({
                customerId,
                partnerId,
                channel: 'OTP',
                outcome: 'DENIED',
                disclosureType: 'NONE',
                reason: 'Data integrity verification failed.'
            });
            res.status(500).json({ error: 'Data integrity verification failed.' });
            return;
        }

        const fullPii = JSON.parse(decryptedString) as Record<string, string>;
        const filteredPii = { ...fullPii };

        if (disclosureType === 'NAME_ONLY') {
            filteredPii.govId = 'Hidden for privacy';
        } else if (disclosureType === 'PROOF_OF_EXISTENCE') {
            filteredPii.fullName = 'Hidden';
            filteredPii.govId = 'Hidden';
            filteredPii.status = 'Verified identity on file';
        }

        await prisma.otpChallenge.delete({ where: otpWhere });
        await recordAccess({
            customerId,
            partnerId,
            channel: 'OTP',
            outcome: 'GRANTED',
            disclosureType
        });

        res.json({
            success: true,
            customerId,
            pii: filteredPii,
            verifiedVia: `One-time password (${disclosureType})`,
            verifiedAt: new Date(status.verifiedAt * 1000).toISOString(),
            issuedAt: new Date().toISOString()
        });
    } catch (error) {
        handleServerError(res, 'Unable to verify the OTP.', error);
    }
});

app.delete('/api/kyc/forget', authenticateToken, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;

    if (authReq.user.role !== 'CUSTOMER') {
        res.status(403).json({ error: 'Unauthorized role.' });
        return;
    }

    const customerId = authReq.user.bankId;

    try {
        const deleted = await prisma.$transaction(async (tx) => {
            await tx.consent.deleteMany({ where: { customerId } });
            return tx.customer.deleteMany({ where: { publicId: customerId } });
        });

        await clearOtpChallengesForCustomer(customerId);

        if (deleted.count === 0) {
            res.status(404).json({ error: 'No data found to delete.' });
            return;
        }

        res.json({
            success: true,
            message: 'All off-chain PII for this customer has been permanently deleted.',
            deletedRecords: deleted.count
        });
    } catch (error) {
        handleServerError(res, 'Unable to delete customer data.', error);
    }
});

app.post('/api/kyc/set-expiry', authenticateToken, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;

    if (authReq.user.role !== 'CUSTOMER') {
        res.status(403).json({ error: 'Unauthorized role.' });
        return;
    }

    const customerId = authReq.user.bankId;
    const minutes = Number(req.body.minutes);

    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10_080) {
        res.status(400).json({ error: 'Expiry must be an integer between 0 and 10080 minutes.' });
        return;
    }

    try {
        const customer = await ensureCustomerRecord(customerId);

        if (!customer) {
            res.status(404).json({ error: 'No verified customer record exists yet.' });
            return;
        }

        const expiresAt = minutes === 0 ? null : new Date(Date.now() + minutes * 60_000);

        await prisma.customer.update({
            where: { publicId: customerId },
            data: { expiresAt }
        });

        res.json({ success: true, expiresAt });
    } catch (error) {
        handleServerError(res, 'Unable to update the expiry timer.', error);
    }
});

app.get('/health', (_req, res) => {
    res.json({ ok: true });
});

process.on('SIGINT', async () => {
    clearInterval(selfDestructSweep);
    await prisma.$disconnect();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    clearInterval(selfDestructSweep);
    await prisma.$disconnect();
    process.exit(0);
});

const PORT = process.env.PORT || 3001;

/**
 * Prove the key material works before accepting traffic. A missing IAM binding
 * or a typo'd key name should fail the deploy here, at startup, rather than
 * surfacing as a 500 in front of a verifier holding a customer's documents.
 */
async function start(): Promise<void> {
    if (process.env.KMS_PII_KEK) {
        await assertKmsReachable();
        console.log('[startup] Cloud KMS envelope encryption verified.');
    } else if (process.env.NODE_ENV === 'production') {
        throw new Error('KMS_PII_KEK is required in production; refusing to start with environment-variable encryption.');
    } else {
        console.warn('[security] KMS_PII_KEK is not set; falling back to legacy ENCRYPTION_KEY encryption.');
    }

    try {
        console.log(`[startup] Ethereum operator address: ${await getOperatorAddress()}`);
    } catch (error) {
        console.error('[startup] Unable to resolve the operator signing key.', error);
        throw error;
    }

    app.listen(PORT, () => {
        console.log(`Backend running on port ${PORT}`);
    });
}

start().catch((error) => {
    console.error('[startup] Fatal error during startup.', error);
    process.exit(1);
});
