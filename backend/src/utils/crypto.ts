import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const CURRENT_KEY_VERSION = 'v1';

function parseKey(value: string, source: string): Buffer {
    if (!/^[0-9a-fA-F]{64}$/.test(value)) {
        throw new Error(`${source} must be a 64-character hexadecimal string.`);
    }

    return Buffer.from(value, 'hex');
}

function getEncryptionKey(): Buffer {
    const encryptionKey = process.env.ENCRYPTION_KEY;

    if (!encryptionKey) {
        throw new Error('ENCRYPTION_KEY environment variable is required.');
    }

    return parseKey(encryptionKey, 'ENCRYPTION_KEY');
}

// Decryption keys are tried in order, so rotating means promoting the old key
// to ENCRYPTION_KEY_PREVIOUS and putting the new one in ENCRYPTION_KEY.
// Existing ciphertext keeps decrypting; anything re-encrypted uses the new key.
function getDecryptionKeys(): Buffer[] {
    const keys = [getEncryptionKey()];
    const previousKey = process.env.ENCRYPTION_KEY_PREVIOUS;

    if (previousKey) {
        keys.push(parseKey(previousKey, 'ENCRYPTION_KEY_PREVIOUS'));
    }

    return keys;
}

export async function encrypt(text: string): Promise<string> {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return `${CURRENT_KEY_VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export async function decrypt(encryptedText: string): Promise<string> {
    const parts = encryptedText.split(':');

    // Legacy records were written as `iv:tag:data` before key versioning existed.
    const [iv, authTag, encrypted] = parts.length === 4 ? parts.slice(1) : parts;

    if (!iv || !authTag || encrypted === undefined) {
        throw new Error('Malformed ciphertext.');
    }

    let lastError: unknown;

    for (const key of getDecryptionKeys()) {
        try {
            const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
            decipher.setAuthTag(Buffer.from(authTag, 'hex'));
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Unable to decrypt payload.');
}

export function hashData(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}
