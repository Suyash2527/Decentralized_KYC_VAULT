import 'dotenv/config';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { checkStatusOnChain, grantConsentOnChain, normalizePartnerId, revokeConsentOnChain, verifyKYCOnChain } from './services/blockchain';
import { decrypt, encrypt, hashData } from './utils/crypto';
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

interface OtpRecord {
    attemptsRemaining: number;
    disclosureType: DisclosureType;
    expiresAt: number;
    otpHash: string;
    partnerId: string;
    salt: string;
}

const app = express();
const prisma = new PrismaClient();

const corsOrigins = process.env.CORS_ORIGIN
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);

app.use(cors(corsOrigins && corsOrigins.length > 0 ? { origin: corsOrigins } : undefined));
app.use(express.json());

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
const otpStore = new Map<string, OtpRecord>();

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

function makeOtpKey(customerId: string, partnerId: string): string {
    return `${customerId}::${normalizePartnerId(partnerId)}`;
}

function hashOtp(customerId: string, partnerId: string, otp: string, salt: string): string {
    return hashData(`${customerId}:${normalizePartnerId(partnerId)}:${salt}:${otp}`);
}

function clearOtpChallengesForCustomer(customerId: string) {
    for (const key of otpStore.keys()) {
        if (key.startsWith(`${customerId}::`)) {
            otpStore.delete(key);
        }
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
            clearOtpChallengesForCustomer(customer.publicId);
            await prisma.$transaction([
                prisma.consent.deleteMany({ where: { customerId: customer.publicId } }),
                prisma.customer.delete({ where: { id: customer.id } })
            ]);
        }
    } catch (error) {
        console.error('Self-destruct sweep failed.', error);
    }
}, SELF_DESTRUCT_SWEEP_MS);

app.post('/api/auth/register', async (req, res) => {
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

app.post('/api/auth/login', async (req, res) => {
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
        const encryptedPII = await encrypt(piiPayload);
        const txHash = await verifyKYCOnChain(customerId, `0x${piiHash}`);

        await prisma.customer.upsert({
            where: { publicId: customerId },
            update: { encryptedPII, piiHash, expiresAt: null },
            create: { publicId: customerId, encryptedPII, piiHash }
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

    try {
        const status = await checkStatusOnChain(customerId, authReq.user.bankId);

        if (!status.isVerified) {
            res.status(404).json({ error: 'No verified on-chain KYC proof found.' });
            return;
        }

        if (!status.hasConsent) {
            res.status(403).json({ error: 'Access denied: no active consent found.' });
            return;
        }

        const customer = await ensureCustomerRecord(customerId);

        if (!customer) {
            res.status(404).json({ error: 'Data not found in secure storage.' });
            return;
        }

        const decryptedString = await decrypt(customer.encryptedPII);
        const currentHash = `0x${hashData(decryptedString)}`.toLowerCase();

        if (currentHash !== status.payloadHash) {
            res.status(500).json({ error: 'Data integrity verification failed.' });
            return;
        }

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

app.get('/api/audit/:customerId', authenticateToken, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const customerId = normalizeIdentifier(req.params.customerId);

    if (authReq.user.role !== 'CUSTOMER' || authReq.user.bankId !== customerId) {
        res.status(403).json({ error: 'You can only access your own audit trail.' });
        return;
    }

    try {
        const [consents, customer] = await Promise.all([
            prisma.consent.findMany({
                where: { customerId },
                orderBy: { updatedAt: 'desc' }
            }),
            ensureCustomerRecord(customerId)
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
        const partnerId = partner.bankId;

        otpStore.set(makeOtpKey(customerId, partnerId), {
            attemptsRemaining: OTP_MAX_ATTEMPTS,
            disclosureType,
            expiresAt: Date.now() + OTP_TTL_MS,
            otpHash: hashOtp(customerId, partnerId, otp, salt),
            partnerId,
            salt
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

app.post('/api/otp/verify', authenticateToken, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;

    if (authReq.user.role !== 'PARTNER') {
        res.status(403).json({ error: 'Unauthorized role.' });
        return;
    }

    const customerId = normalizeIdentifier(req.body.customerId);
    const otp = normalizeIdentifier(req.body.otp);

    if (!customerId || !/^\d{6}$/.test(otp)) {
        res.status(400).json({ error: 'Customer ID and a valid 6-digit OTP are required.' });
        return;
    }

    const otpKey = makeOtpKey(customerId, authReq.user.bankId);
    const record = otpStore.get(otpKey);

    if (!record) {
        res.status(404).json({ error: 'No active OTP exists for this customer and partner.' });
        return;
    }

    if (Date.now() > record.expiresAt) {
        otpStore.delete(otpKey);
        res.status(401).json({ error: 'OTP has expired. Ask the customer to generate a new one.' });
        return;
    }

    const expectedHash = hashOtp(customerId, record.partnerId, otp, record.salt);
    if (expectedHash !== record.otpHash) {
        record.attemptsRemaining -= 1;

        if (record.attemptsRemaining <= 0) {
            otpStore.delete(otpKey);
            res.status(429).json({ error: 'OTP verification attempts exhausted. Ask for a new OTP.' });
            return;
        }

        otpStore.set(otpKey, record);
        res.status(400).json({ error: `Invalid OTP. ${record.attemptsRemaining} attempts remaining.` });
        return;
    }

    try {
        const [customer, status] = await Promise.all([
            ensureCustomerRecord(customerId),
            checkStatusOnChain(customerId, authReq.user.bankId)
        ]);

        if (!customer) {
            res.status(404).json({ error: 'Customer data not found in the vault.' });
            return;
        }

        if (!status.isVerified) {
            res.status(404).json({ error: 'No verified on-chain KYC proof found.' });
            return;
        }

        const decryptedString = await decrypt(customer.encryptedPII);
        const currentHash = `0x${hashData(decryptedString)}`.toLowerCase();

        if (currentHash !== status.payloadHash) {
            res.status(500).json({ error: 'Data integrity verification failed.' });
            return;
        }

        const fullPii = JSON.parse(decryptedString) as Record<string, string>;
        const filteredPii = { ...fullPii };

        if (record.disclosureType === 'NAME_ONLY') {
            filteredPii.govId = 'Hidden for privacy';
        } else if (record.disclosureType === 'PROOF_OF_EXISTENCE') {
            filteredPii.fullName = 'Hidden';
            filteredPii.govId = 'Hidden';
            filteredPii.status = 'Verified identity on file';
        }

        otpStore.delete(otpKey);

        res.json({
            success: true,
            customerId,
            pii: filteredPii,
            verifiedVia: `One-time password (${record.disclosureType})`,
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

        clearOtpChallengesForCustomer(customerId);

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
app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
});
