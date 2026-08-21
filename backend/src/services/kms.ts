import { KeyManagementServiceClient } from '@google-cloud/kms';
import crypto from 'crypto';

/**
 * Thin, shared wrapper around Cloud KMS.
 *
 * One client for the whole process: the underlying gRPC channel is pooled and
 * reused, and creating a client per call would re-run credential discovery on
 * every request.
 */

let client: KeyManagementServiceClient | null = null;

export function kmsClient(): KeyManagementServiceClient {
    if (!client) {
        client = new KeyManagementServiceClient();
    }

    return client;
}

export function requireEnv(name: string): string {
    const value = process.env[name];

    if (!value || value.trim() === '') {
        throw new Error(`${name} environment variable is required.`);
    }

    return value.trim();
}

export function kmsLocationPath(): string {
    return kmsClient().locationPath(requireEnv('GCP_PROJECT_ID'), requireEnv('KMS_LOCATION'));
}

/** Resource name of the symmetric key that wraps per-record data keys. */
export function piiKekName(): string {
    return kmsClient().cryptoKeyPath(
        requireEnv('GCP_PROJECT_ID'),
        requireEnv('KMS_LOCATION'),
        requireEnv('KMS_KEY_RING'),
        requireEnv('KMS_PII_KEK')
    );
}

/** Resource name of the specific asymmetric key version used for signing. */
export function signingKeyVersionName(): string {
    return kmsClient().cryptoKeyVersionPath(
        requireEnv('GCP_PROJECT_ID'),
        requireEnv('KMS_LOCATION'),
        requireEnv('KMS_KEY_RING'),
        requireEnv('KMS_SIGNING_KEY'),
        process.env.KMS_SIGNING_KEY_VERSION?.trim() || '1'
    );
}

/**
 * CRC32C over the wire is not optional politeness: KMS returns a checksum with
 * every ciphertext, and a mismatch means the payload was corrupted in transit.
 * Silently accepting a corrupted wrapped-DEK would produce data we can never
 * decrypt again, so we verify and fail loudly instead.
 */
const CRC_TABLE = (() => {
    const table = new Int32Array(256);

    for (let i = 0; i < 256; i += 1) {
        let value = i;

        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1;
        }

        table[i] = value;
    }

    return table;
})();

export function crc32c(buffer: Buffer): number {
    let crc = 0xffffffff;

    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
}

function assertChecksum(label: string, buffer: Buffer, expected: unknown): void {
    if (expected === null || expected === undefined) {
        return;
    }

    const expectedValue = Number(typeof expected === 'object' && 'value' in (expected as any)
        ? (expected as any).value
        : expected);

    if (!Number.isFinite(expectedValue)) {
        return;
    }

    if (crc32c(buffer) !== expectedValue) {
        throw new Error(`${label}: KMS response failed CRC32C verification; the payload was corrupted in transit.`);
    }
}

/**
 * Generate a 256-bit data-encryption key.
 *
 * Preference is KMS's HSM-backed RNG (FIPS 140-2 Level 3 entropy, which is
 * what a regulator expects behind a key protecting PII). If that call is
 * unavailable - older region, quota, or the permission is not granted - we
 * fall back to the local CSPRNG rather than failing the request, because
 * node's crypto.randomBytes is itself an acceptable source.
 */
export async function generateDek(): Promise<Buffer> {
    try {
        const [response] = await kmsClient().generateRandomBytes({
            location: kmsLocationPath(),
            lengthBytes: 32,
            protectionLevel: 'HSM'
        });

        const data = response.data;

        if (data && data.length === 32) {
            const dek = Buffer.from(data as Uint8Array);
            assertChecksum('generateRandomBytes', dek, response.dataCrc32c);
            return dek;
        }
    } catch {
        // fall through to the local CSPRNG
    }

    return crypto.randomBytes(32);
}

export interface WrappedKey {
    /** Base64 of the KMS-wrapped DEK. Safe to store next to the ciphertext. */
    wrapped: string;
    /** Full resource name of the key version that did the wrapping. */
    keyVersion: string;
}

/**
 * Wrap a DEK under the PII KEK.
 *
 * `context` is passed as Additional Authenticated Data. It binds the wrapped
 * key to one specific record: a wrapped DEK lifted from customer A's row and
 * pasted onto customer B's row will fail to unwrap, because the AAD no longer
 * matches. Without AAD, row-swapping is a valid attack against an operator
 * with database write access.
 */
export async function wrapDek(dek: Buffer, context: string): Promise<WrappedKey> {
    const aad = Buffer.from(context, 'utf8');

    const [response] = await kmsClient().encrypt({
        name: piiKekName(),
        plaintext: dek,
        plaintextCrc32c: { value: crc32c(dek) },
        additionalAuthenticatedData: aad,
        additionalAuthenticatedDataCrc32c: { value: crc32c(aad) }
    });

    if (!response.ciphertext) {
        throw new Error('KMS returned an empty wrapped key.');
    }

    if (response.verifiedPlaintextCrc32c !== true) {
        throw new Error('KMS did not verify the request checksum; the request was corrupted in transit.');
    }

    const ciphertext = Buffer.from(response.ciphertext as Uint8Array);
    assertChecksum('wrapDek', ciphertext, response.ciphertextCrc32c);

    return {
        wrapped: ciphertext.toString('base64'),
        keyVersion: response.name ?? piiKekName()
    };
}

/** Unwrap a DEK. Every call is recorded in Cloud Audit Logs as a DATA_READ. */
export async function unwrapDek(wrapped: string, context: string): Promise<Buffer> {
    const ciphertext = Buffer.from(wrapped, 'base64');
    const aad = Buffer.from(context, 'utf8');

    const [response] = await kmsClient().decrypt({
        name: piiKekName(),
        ciphertext,
        ciphertextCrc32c: { value: crc32c(ciphertext) },
        additionalAuthenticatedData: aad,
        additionalAuthenticatedDataCrc32c: { value: crc32c(aad) }
    });

    if (!response.plaintext) {
        throw new Error('KMS returned an empty data key.');
    }

    const dek = Buffer.from(response.plaintext as Uint8Array);
    assertChecksum('unwrapDek', dek, response.plaintextCrc32c);

    if (dek.length !== 32) {
        throw new Error(`Unwrapped data key has the wrong length (${dek.length} bytes, expected 32).`);
    }

    return dek;
}

/**
 * Fail fast at boot rather than on the first customer request: a missing IAM
 * binding or a typo'd key name should stop a deploy, not surface as a 500 in
 * front of a verifier.
 */
export async function assertKmsReachable(): Promise<void> {
    const probe = Buffer.alloc(32, 0);
    const wrapped = await wrapDek(probe, 'startup-probe');
    const unwrapped = await unwrapDek(wrapped.wrapped, 'startup-probe');

    if (!crypto.timingSafeEqual(probe, unwrapped)) {
        throw new Error('KMS round-trip probe returned unexpected material.');
    }
}
