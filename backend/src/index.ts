import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { encrypt, decrypt, hashData } from './utils/crypto';
import { verifyKYCOnChain, grantConsentOnChain, checkStatusOnChain } from './services/blockchain';

const app = express();
const prisma = new PrismaClient();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.ENCRYPTION_KEY || 'supersecretfallback';

// Seed mock users for Hackathon
async function seedUsers() {
    const count = await prisma.bankUser.count();
    if (count === 0) {
        console.log('Seeding mock users...');
        await prisma.bankUser.createMany({
            data: [
                { username: 'bankA', passwordHash: 'password', bankId: 'BANK_A', role: 'VERIFIER' },
                { username: 'bankB', passwordHash: 'password', bankId: 'BANK_B', role: 'PARTNER' },
                { username: 'john', passwordHash: 'password', bankId: 'john_doe_public_123', role: 'CUSTOMER' }
            ]
        });
        console.log('Mock users seeded: bankA, bankB, john (password for all is "password")');
    }
}
seedUsers();

// Auth Middleware
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

// Registration Route
app.post('/api/auth/register', async (req, res) => {
    const { username, password, role } = req.body;
    try {
        const existing = await prisma.bankUser.findUnique({ where: { username } });
        if (existing) return res.status(400).json({ error: 'Username already taken' });
        
        // For hackathon simplicity, publicId is just the username
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

// Login Route
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await prisma.bankUser.findUnique({ where: { username } });
    
    if (user && user.passwordHash === password) { // simple mock auth
        const token = jwt.sign({ username: user.username, role: user.role, bankId: user.bankId }, JWT_SECRET, { expiresIn: '2h' });
        res.json({ token, user: { username: user.username, role: user.role, bankId: user.bankId } });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// Protected KYC Verification (Only VERIFIER)
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

// Protected Consent Grant (Only CUSTOMER)
app.post('/api/consent/grant', authenticateToken, async (req: any, res: any) => {
    if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Unauthorized role' });
    try {
        const customerId = req.user.bankId; // Use logged in user's ID
        const { partnerId, partnerAddress, customerPrivateKey } = req.body;
        
        // Default to a hardcoded address for the demo if none provided
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
        const { partnerId } = req.body;

        await prisma.consent.update({
            where: { customerId_partnerId: { customerId, partnerId } },
            data: { status: 'REVOKED' }
        });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Protected Access Console (Only PARTNER)
app.get('/api/kyc/access/:customerId', authenticateToken, async (req: any, res: any) => {
    if (req.user.role !== 'PARTNER') return res.status(403).json({ error: 'Unauthorized role' });
    try {
        const { customerId } = req.params;
        let { partnerAddress } = req.query; // in reality, partnerAddress could be linked to user.bankId
        partnerAddress = partnerAddress || "0xad4310c1b8e3ce2b36a8e2b62d3c4c35ea2c43eb";

        const status = await checkStatusOnChain(customerId, partnerAddress as string);
        if (!status.hasConsent) {
            return res.status(403).json({ error: 'Access Denied: No active consent found on the blockchain.' });
        }

        const customer = await prisma.customer.findUnique({ where: { publicId: customerId } });
        if (!customer) {
            return res.status(404).json({ error: 'Data not found in off-chain database.' });
        }

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
