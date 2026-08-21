import crypto from 'crypto';
import { generateDek, unwrapDek, wrapDek } from '../services/kms';

/**
 * Envelope encryption for customer PII.
 *
 * Every record gets its own 256-bit data-encryption key (DEK). The PII is
 * encrypted locally with AES-256-GCM under that DEK; the DEK itself is then
 * wrapped by a Cloud KMS key (the KEK) that never leaves the HSM.
 *
 * Why this shape rather than a single application-wide key:
 *
 *   - Cloud KMS never sees plaintext PII. It only ever handles 32 bytes of
 *     key material, so there is no size limit and no PII in KMS audit logs.
 *   - There is no long-lived plaintext key in process memory. A DEK exists for
 *     the duration of one request and is zeroed afterwards; a heap dump of a
 *     running container yields at most the record being handled right then,
 *     not the key to the entire database.
 *   - Rotating the KEK is a metadata operation. Old wrapped DEKs keep
 *     decrypting under their original key version, and nothing has to be
 *     re-encrypted for rotation to take effect on new writes.
 *   - Every single decryption produces a Cloud Audit Log entry naming the
 *     principal and the time. "Who read this customer's data" becomes a query
 *     rather than an inference.
 *
 * Ciphertext format (self-describing so old and new rows coexist):
 *
 *   v2:<base64 wrapped DEK>:<hex iv>:<hex auth tag>:<hex ciphertext>
 *   v1:<hex iv>:<hex auth tag>:<hex ciphertext>          legacy, single key
 *   <hex iv>:<hex auth tag>:<hex ciphertext>             pre-versioning
 */

const ALGORITHM = 'aes-256-gcm';
const CURRENT_VERSION = 'v2';
const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for

export interface SealedPayload {
    /** The full self-describing ciphertext blob to persist. */
    payload: string;
    /** KMS key version that wrapped this record's DEK, for rotation reporting. */
    kmsKeyVersion: string;
}

function zero(buffer: Buffer): void {
    buffer.fill(0);
}

/**
 * Encrypt PII under a fresh per-record DEK.
 *
 * `context` must be a stable identifier for the record - the customer's
 * publicId. It is bound into the wrapped DEK as Additional Authenticated Data,
 * so a wrapped key is only usable on the row it was created for.
 */
export async function sealPII(plaintext: string, context: string): Promise<SealedPayload> {
    if (!context) {
        throw new Error('An encryption context is required; refusing to seal PII without one.');
    }

    const dek = await generateDek();

    try {
        const { wrapped, keyVersion } = await wrapDek(dek, context);
        const iv = crypto.randomBytes(IV_BYTES);
        const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);

        const ciphertext = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final()
        ]);

        const authTag = cipher.getAuthTag();

        return {
            payload: [
                CURRENT_VERSION,
                wrapped,
                iv.toString('hex'),
                authTag.toString('hex'),
                ciphertext.toString('hex')
            ].join(':'),
            kmsKeyVersion: keyVersion
        };
    } finally {
        zero(dek);
    }
}

/** Decrypt a payload written by any format version this file has ever used. */
export async function openPII(payload: string, context: string): Promise<string> {
    const parts = payload.split(':');

    if (parts[0] === CURRENT_VERSION) {
        const [, wrapped, ivHex, tagHex, dataHex] = parts;

        if (!wrapped || !ivHex || !tagHex || dataHex === undefined) {
            throw new Error('Malformed v2 ciphertext.');
        }

        const dek = await unwrapDek(wrapped, context);

        try {
            return decryptWith(dek, ivHex, tagHex, dataHex);
        } finally {
            zero(dek);
        }
    }

    return decryptLegacy(parts);
}

function decryptWith(key: Buffer, ivHex: string, tagHex: string, dataHex: string): string {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

    return Buffer.concat([
        decipher.update(Buffer.from(dataHex, 'hex')),
        decipher.final()
    ]).toString('utf8');
}

/**
 * Pre-KMS records. Kept so the cutover does not need a big-bang re-encryption
 * window: rows are upgraded lazily on their next write, and the backfill
 * script (scripts/backfill-envelope.ts) sweeps the rest.
 *
 * Delete this function - and the two ENCRYPTION_KEY variables - once the
 * backfill reports zero remaining v1 rows.
 */
function legacyKeys(): Buffer[] {
    const keys: Buffer[] = [];

    for (const name of ['ENCRYPTION_KEY', 'ENCRYPTION_KEY_PREVIOUS']) {
        const value = process.env[name];

        if (!value) {
            continue;
        }

        if (!/^[0-9a-fA-F]{64}$/.test(value)) {
            throw new Error(`${name} must be a 64-character hexadecimal string.`);
        }

        keys.push(Buffer.from(value, 'hex'));
    }

    return keys;
}

function decryptLegacy(parts: string[]): string {
    const [ivHex, tagHex, dataHex] = parts.length === 4 ? parts.slice(1) : parts;

    if (!ivHex || !tagHex || dataHex === undefined) {
        throw new Error('Malformed ciphertext.');
    }

    const keys = legacyKeys();

    if (keys.length === 0) {
        throw new Error(
            'Encountered a pre-KMS record but no legacy ENCRYPTION_KEY is configured. ' +
            'Run scripts/backfill-envelope.ts with the legacy key set before removing it.'
        );
    }

    let lastError: unknown;

    for (const key of keys) {
        try {
            return decryptWith(key, ivHex, tagHex, dataHex);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Unable to decrypt payload.');
}

/** True when a stored payload still uses the pre-KMS format. */
export function isLegacyPayload(payload: string): boolean {
    return !payload.startsWith(`${CURRENT_VERSION}:`);
}

export function hashData(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}
