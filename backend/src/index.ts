import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { encrypt, decrypt, hashData } from './utils/crypto';
import { verifyKYCOnChain, grantConsentOnChain, revokeConsentOnChain, checkStatusOnChain } from './services/blockchain';

const app = express();
const prisma = new PrismaClient();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const JWT_SECRET = process.env.ENCRYPTION_KEY || 'supersecretfallback';
const GCP_API_KEY = process.env.GCP_API_KEY;
if (!GCP_API_KEY) {
    console.warn("WARNING: GCP_API_KEY is not set in environment variables!");
}

// Removed seedUsers() to allow manual registration from scratch

// ─── Self-Destruct Background Job ───
setInterval(async () => {
    try {
        const expiredCustomers = await prisma.customer.findMany({
            where: {
                expiresAt: { lt: new Date() }
            }
        });
        
        for (const customer of expiredCustomers) {
            console.log(`[Self-Destruct] Purging expired identity for: ${customer.publicId}`);
            await prisma.consent.deleteMany({ where: { customerId: customer.publicId } });
            await prisma.customer.delete({ where: { id: customer.id } });
        }
    } catch (err) {
        console.error("Self-destruct sweep error:", err);
    }
}, 60000); // Check every 60 seconds

// ─── Auth Middleware ───
const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// ═══════════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════════

app.post('/api/auth/register', async (req, res) => {
    const { username, password, role } = req.body;
    try {
        const existing = await prisma.bankUser.findUnique({ where: { username } });
        if (existing) return res.status(400).json({ error: 'Username already taken' });
        const bankId = username;
        const user = await prisma.bankUser.create({
            data: { username, passwordHash: password, role, bankId }
        });
        const token = jwt.sign({ username: user.username, role: user.role, bankId: user.bankId }, JWT_SECRET, { expiresIn: '2h' });
        res.json({ token, user: { username: user.username, role: user.role, bankId: user.bankId } });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await prisma.bankUser.findUnique({ where: { username } });
    if (user && user.passwordHash === password) {
        const token = jwt.sign({ username: user.username, role: user.role, bankId: user.bankId }, JWT_SECRET, { expiresIn: '2h' });
        res.json({ token, user: { username: user.username, role: user.role, bankId: user.bankId } });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// ═══════════════════════════════════════════
//  FEATURE 1: DOCUMENT OCR (Google Cloud Vision)
// ═══════════════════════════════════════════

app.post('/api/ocr/extract', authenticateToken, upload.single('document'), async (req: any, res: any) => {
    if (req.user.role !== 'VERIFIER') return res.status(403).json({ error: 'Unauthorized role' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
        const base64Image = req.file.buffer.toString('base64');
        const visionPayload = {
            requests: [{
                image: { content: base64Image },
                features: [{ type: 'TEXT_DETECTION', maxResults: 1 }]
            }]
        };

        const visionRes = await fetch(
            `https://vision.googleapis.com/v1/images:annotate?key=${GCP_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(visionPayload)
            }
        );
        const visionData: any = await visionRes.json();

        if (visionData.error) {
            return res.status(500).json({ error: visionData.error.message });
        }

        const rawText = visionData.responses?.[0]?.textAnnotations?.[0]?.description || '';

        // ─── Smart field extraction ───
        const lines = rawText.split('\n').map((l: string) => l.trim()).filter(Boolean);
        let fullName = '';
        let govId = '';
        let dob = '';

        // Aadhaar pattern: 12 digits (XXXX XXXX XXXX)
        const aadhaarMatch = rawText.match(/\d{4}\s?\d{4}\s?\d{4}/);
        if (aadhaarMatch) govId = aadhaarMatch[0];

        // PAN pattern: ABCDE1234F
        const panMatch = rawText.match(/[A-Z]{5}\d{4}[A-Z]/);
        if (panMatch && !govId) govId = panMatch[0];

        // DOB pattern
        const dobMatch = rawText.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4})/);
        if (dobMatch) dob = dobMatch[1];

        // Name extraction: look for line after common labels
        for (let i = 0; i < lines.length; i++) {
            const lower = lines[i].toLowerCase();
            if ((lower.includes('name') || lower.includes('नाम')) && i + 1 < lines.length) {
                // Next line is likely the name
                const candidate = lines[i + 1];
                if (candidate && !/\d{4}/.test(candidate) && candidate.length > 2) {
                    fullName = candidate;
                    break;
                }
            }
        }
        // Fallback: use the second or third line as name if nothing found
        if (!fullName && lines.length >= 2) {
            for (const line of lines) {
                if (line.length > 3 && /^[A-Za-z\s]+$/.test(line) && !line.toLowerCase().includes('government') && !line.toLowerCase().includes('india')) {
                    fullName = line;
                    break;
                }
            }
        }

        res.json({
            success: true,
            extracted: { fullName, govId, dob },
            rawText
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════
//  KYC VERIFICATION (VERIFIER)
// ═══════════════════════════════════════════

app.post('/api/kyc/verify', authenticateToken, async (req: any, res: any) => {
    if (req.user.role !== 'VERIFIER') return res.status(403).json({ error: 'Unauthorized role' });
    try {
        const { customerId, pii, bankPrivateKey } = req.body;
        const pk = bankPrivateKey || process.env.DEPLOYER_PRIVATE_KEY;
        if (!pk) throw new Error("No private key provided");

        const piiString = JSON.stringify(pii);
        const piiHash = hashData(piiString);
        const encryptedPII = await encrypt(piiString);

        await prisma.customer.upsert({
            where: { publicId: customerId },
            update: { encryptedPII, piiHash },
            create: { publicId: customerId, encryptedPII, piiHash }
        });

        const txHash = await verifyKYCOnChain(customerId, `0x${piiHash}`, pk);
        res.json({ success: true, txHash, piiHash });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════
//  CONSENT MANAGEMENT (CUSTOMER)
// ═══════════════════════════════════════════

app.post('/api/consent/grant', authenticateToken, async (req: any, res: any) => {
    if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Unauthorized role' });
    try {
        const customerId = req.user.bankId;
        const { partnerId, partnerAddress, customerPrivateKey } = req.body;
        const pAddr = partnerAddress || "0xad4310c1b8e3ce2b36a8e2b62d3c4c35ea2c43eb";
        const pk = customerPrivateKey || process.env.DEPLOYER_PRIVATE_KEY;

        await prisma.consent.upsert({
            where: { customerId_partnerId: { customerId, partnerId } },
            update: { status: 'GRANTED' },
            create: { customerId, partnerId, status: 'GRANTED' }
        });

        const txHash = await grantConsentOnChain(customerId, pAddr, pk);
        res.json({ success: true, txHash });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/consent/revoke', authenticateToken, async (req: any, res: any) => {
    if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Unauthorized role' });
    try {
        const customerId = req.user.bankId;
        const { partnerId, partnerAddress, customerPrivateKey } = req.body;
        
        const pAddr = partnerAddress || "0xad4310c1b8e3ce2b36a8e2b62d3c4c35ea2c43eb";
        const pk = customerPrivateKey || process.env.DEPLOYER_PRIVATE_KEY;

        // Update Consent status in database
        await prisma.consent.update({
            where: { customerId_partnerId: { customerId, partnerId } },
            data: { status: 'REVOKED' }
        });

        // Revoke on chain
        const txHash = await revokeConsentOnChain(customerId, pAddr, pk);
        
        res.json({ success: true, txHash });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════
//  PARTNER ACCESS (PARTNER)
// ═══════════════════════════════════════════

app.get('/api/kyc/access/:customerId', authenticateToken, async (req: any, res: any) => {
    if (req.user.role !== 'PARTNER') return res.status(403).json({ error: 'Unauthorized role' });
    try {
        const { customerId } = req.params;
        let { partnerAddress } = req.query;
        partnerAddress = partnerAddress || "0xad4310c1b8e3ce2b36a8e2b62d3c4c35ea2c43eb";

        const status = await checkStatusOnChain(customerId, partnerAddress as string);
        if (!status.hasConsent) {
            return res.status(403).json({ error: 'Access Denied: No active consent found on the blockchain.' });
        }

        const customer = await prisma.customer.findUnique({ where: { publicId: customerId } });
        if (!customer) return res.status(404).json({ error: 'Data not found in off-chain database.' });

        const decryptedStr = await decrypt(customer.encryptedPII);
        const currentHash = hashData(decryptedStr);
        if (`0x${currentHash}` !== status.payloadHash) {
            return res.status(500).json({ error: 'Data integrity compromise detected.' });
        }

        res.json({ success: true, pii: JSON.parse(decryptedStr), verifiedAt: status.verifiedAt });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════
//  FEATURE 2: CONSENT AUDIT TRAIL
// ═══════════════════════════════════════════

app.get('/api/audit/:customerId', authenticateToken, async (req: any, res: any) => {
    try {
        const { customerId } = req.params;

        // Fetch all consents from database for this customer
        const consents = await prisma.consent.findMany({
            where: { customerId },
            orderBy: { updatedAt: 'desc' }
        });

        // Fetch the customer KYC record
        const customer = await prisma.customer.findUnique({ where: { publicId: customerId } });

        const auditTrail: any[] = [];

        // Add KYC verification event
        if (customer) {
            auditTrail.push({
                type: 'KYC_VERIFIED',
                icon: '🔒',
                title: 'KYC Identity Verified',
                description: `PII encrypted (AES-256-GCM) and proof minted on Ethereum Sepolia.`,
                timestamp: customer.createdAt,
                hash: customer.piiHash ? `0x${customer.piiHash.substring(0, 16)}...` : null
            });
        }

        // Add consent events
        for (const consent of consents) {
            auditTrail.push({
                type: consent.status === 'GRANTED' ? 'CONSENT_GRANTED' : 'CONSENT_REVOKED',
                icon: consent.status === 'GRANTED' ? '✅' : '🚫',
                title: consent.status === 'GRANTED' ? `Access Granted to ${consent.partnerId}` : `Access Revoked from ${consent.partnerId}`,
                description: consent.status === 'GRANTED'
                    ? `Customer authorized ${consent.partnerId} to access encrypted PII via smart contract.`
                    : `Customer revoked ${consent.partnerId}'s access. Smart contract will block future queries.`,
                timestamp: consent.updatedAt,
                partnerId: consent.partnerId
            });
        }

        // Sort by timestamp descending
        auditTrail.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        res.json({ success: true, customerId, auditTrail, expiresAt: customer?.expiresAt || null });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════
//  FEATURE 4: SECURE OTP IDENTITY SHARING
// ═══════════════════════════════════════════

const otpStore = new Map(); // In-memory store for Hackathon. Production would use Redis.

app.post('/api/otp/generate', authenticateToken, async (req: any, res: any) => {
    if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Unauthorized role' });
    try {
        const customerId = req.user.bankId;
        const { disclosureType } = req.body; // 'FULL', 'NAME_ONLY', 'PROOF_OF_EXISTENCE'
        
        // Generate a 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString(); 
        
        // Store it with a 5-minute expiration and the requested disclosure level
        otpStore.set(customerId, { 
            otp, 
            expiresAt: Date.now() + 5 * 60 * 1000,
            disclosureType: disclosureType || 'FULL'
        });

        res.json({ success: true, otp, expiresIn: '5 minutes' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/otp/verify', authenticateToken, async (req: any, res: any) => {
    if (req.user.role !== 'PARTNER') return res.status(403).json({ error: 'Unauthorized role' });
    try {
        const { customerId, otp } = req.body;
        
        const record = otpStore.get(customerId);
        if (!record) {
            return res.status(404).json({ error: 'No active OTP found for this customer.' });
        }
        if (Date.now() > record.expiresAt) {
            otpStore.delete(customerId);
            return res.status(401).json({ error: 'OTP has expired. Ask the customer to generate a new one.' });
        }
        if (record.otp !== otp) {
            return res.status(400).json({ error: 'Invalid 6-digit OTP.' });
        }

        // OTP is valid! Fetch and decrypt the PII.
        const customer = await prisma.customer.findUnique({ where: { publicId: customerId } });
        if (!customer) return res.status(404).json({ error: 'Customer data not found in vault.' });

        const decryptedStr = await decrypt(customer.encryptedPII);
        const fullPii = JSON.parse(decryptedStr);
        
        // Apply Selective Disclosure Zero-Knowledge logic
        let filteredPii: any = { ...fullPii };
        if (record.disclosureType === 'NAME_ONLY') {
            filteredPii.govId = 'Hidden for Privacy (Zero-Knowledge)';
            filteredPii.dob = 'Hidden';
        } else if (record.disclosureType === 'PROOF_OF_EXISTENCE') {
            filteredPii.fullName = 'Hidden';
            filteredPii.govId = 'Hidden';
            filteredPii.dob = 'Hidden';
            filteredPii.status = '✅ Verified Valid Citizen Identity';
        }
        
        // OTP successfully verified, so we can clear it to prevent reuse
        otpStore.delete(customerId);

        res.json({
            success: true,
            customerId: customerId,
            pii: filteredPii,
            verifiedVia: `One-Time Password (${record.disclosureType})`,
            issuedAt: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════
//  FEATURE 5: RIGHT TO BE FORGOTTEN (DPDP)
// ═══════════════════════════════════════════

app.delete('/api/kyc/forget', authenticateToken, async (req: any, res: any) => {
    if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Unauthorized role' });
    try {
        const customerId = req.user.bankId;

        // Delete all consents first (foreign key)
        await prisma.consent.deleteMany({ where: { customerId } });

        // Delete the customer PII record
        const deleted = await prisma.customer.deleteMany({ where: { publicId: customerId } });

        if (deleted.count === 0) {
            return res.status(404).json({ error: 'No data found to delete.' });
        }

        res.json({
            success: true,
            message: 'All PII has been permanently deleted from Google Cloud SQL. The on-chain hash is now cryptographically orphaned and cannot be reversed.',
            deletedRecords: deleted.count
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/kyc/set-expiry', authenticateToken, async (req: any, res: any) => {
    if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Unauthorized role' });
    try {
        const customerId = req.user.bankId;
        const { minutes } = req.body;
        
        let expiresAt = null;
        if (minutes) {
            expiresAt = new Date(Date.now() + minutes * 60000);
        }

        await prisma.customer.update({
            where: { publicId: customerId },
            data: { expiresAt }
        });

        res.json({ success: true, expiresAt });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
