import crypto from 'crypto';
import { promisify } from 'util';

const SCRYPT_KEY_LENGTH = 64;
const SALT_BYTES = 16;
const scryptAsync = promisify(crypto.scrypt);

export interface PasswordVerificationResult {
    valid: boolean;
    needsRehash: boolean;
}

function safeBufferEquals(left: Buffer, right: Buffer): boolean {
    if (left.length !== right.length) {
        return false;
    }

    return crypto.timingSafeEqual(left, right);
}

export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
    const derivedKey = await scryptAsync(password, salt, SCRYPT_KEY_LENGTH) as Buffer;

    return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, storedValue: string): Promise<PasswordVerificationResult> {
    const parts = storedValue.split(':');

    if (parts.length !== 2) {
        return {
            valid: safeBufferEquals(Buffer.from(password), Buffer.from(storedValue)),
            needsRehash: true
        };
    }

    const [salt, storedHash] = parts;
    const derivedKey = await scryptAsync(password, salt, SCRYPT_KEY_LENGTH) as Buffer;
    const storedBuffer = Buffer.from(storedHash, 'hex');

    return {
        valid: safeBufferEquals(derivedKey, storedBuffer),
        needsRehash: false
    };
}
