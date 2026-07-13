import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
    const encryptionKey = process.env.ENCRYPTION_KEY;

    if (!encryptionKey) {
        throw new Error('ENCRYPTION_KEY environment variable is required.');
    }

    if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
        throw new Error('ENCRYPTION_KEY must be a 64-character hexadecimal string.');
    }

    return Buffer.from(encryptionKey, 'hex');
}

export async function encrypt(text: string): Promise<string> {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export async function decrypt(encryptedText: string): Promise<string> {
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

export function hashData(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}
