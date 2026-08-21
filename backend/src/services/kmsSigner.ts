import crypto from 'crypto';
import {
    AbstractSigner,
    Provider,
    Signature,
    Transaction,
    TransactionRequest,
    TypedDataDomain,
    TypedDataField,
    TypedDataEncoder,
    computeAddress,
    getBytes,
    hashMessage,
    hexlify,
    recoverAddress
} from 'ethers';
import { crc32c, kmsClient, signingKeyVersionName } from './kms';

/**
 * An ethers v6 Signer backed by a Cloud KMS EC_SIGN_SECP256K1_SHA256 key.
 *
 * The private key is generated inside the HSM and has no export path - not for
 * an operator, not for Google, not for an attacker with full control of this
 * container. A compromised runtime can ask KMS to sign things (which is why
 * the signing-rate alert exists) but cannot steal the key and drain the
 * operator wallet or impersonate it after the breach is closed.
 *
 * Two details make this work with Ethereum:
 *
 *  1. Ethereum digests are keccak256, not SHA-256. KMS signs whatever 32-byte
 *     digest it is handed for a SHA256 key, so we pass the keccak digest in
 *     the `digest.sha256` field. The label is about the expected digest size,
 *     not a hash KMS recomputes.
 *
 *  2. KMS returns a DER-encoded (r, s) with no recovery id, and does not
 *     enforce low-s. We normalise s into the lower half of the curve order as
 *     EIP-2 requires, then recover the parity bit by trying both candidates
 *     and keeping the one that reproduces our own address.
 */

const SECP256K1_N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const HALF_N = SECP256K1_N / 2n;

/** Minimal DER parser for `SEQUENCE { INTEGER r, INTEGER s }`. */
function parseDerSignature(der: Buffer): { r: bigint; s: bigint } {
    if (der[0] !== 0x30) {
        throw new Error('KMS signature is not a DER SEQUENCE.');
    }

    let offset = 2;

    // Long-form length byte (signatures near 128 bytes never hit this, but a
    // silent misparse here would produce an invalid signature, so handle it).
    if (der[1] & 0x80) {
        offset = 2 + (der[1] & 0x7f);
    }

    const readInteger = (): bigint => {
        if (der[offset] !== 0x02) {
            throw new Error('KMS signature is malformed: expected an INTEGER.');
        }

        const length = der[offset + 1];
        const value = der.subarray(offset + 2, offset + 2 + length);
        offset += 2 + length;

        return BigInt(`0x${value.toString('hex')}`);
    };

    const r = readInteger();
    const s = readInteger();

    return { r, s };
}

function toHex32(value: bigint): string {
    return `0x${value.toString(16).padStart(64, '0')}`;
}

export class KmsSigner extends AbstractSigner {
    readonly keyVersionName: string;
    private cachedAddress: string | null = null;

    constructor(provider?: Provider | null, keyVersionName?: string) {
        super(provider ?? null);
        this.keyVersionName = keyVersionName ?? signingKeyVersionName();
    }

    connect(provider: Provider | null): KmsSigner {
        return new KmsSigner(provider, this.keyVersionName);
    }

    /**
     * Derive the Ethereum address from the KMS public key.
     *
     * KMS returns PEM-encoded SPKI. Node parses that; the last 65 bytes of the
     * DER encoding are the uncompressed point (0x04 || X || Y), which is
     * exactly what ethers' computeAddress expects.
     */
    async getAddress(): Promise<string> {
        if (this.cachedAddress) {
            return this.cachedAddress;
        }

        const [publicKey] = await kmsClient().getPublicKey({ name: this.keyVersionName });

        if (!publicKey.pem) {
            throw new Error('KMS did not return a public key. Check roles/cloudkms.publicKeyViewer.');
        }

        if (publicKey.pemCrc32c) {
            const pemBuffer = Buffer.from(publicKey.pem, 'utf8');
            const expected = Number((publicKey.pemCrc32c as { value?: unknown }).value ?? publicKey.pemCrc32c);

            if (Number.isFinite(expected) && crc32c(pemBuffer) !== expected) {
                throw new Error('KMS public key failed CRC32C verification.');
            }
        }

        const der = crypto.createPublicKey(publicKey.pem).export({ format: 'der', type: 'spki' }) as Buffer;
        const uncompressedPoint = der.subarray(der.length - 65);

        if (uncompressedPoint[0] !== 0x04) {
            throw new Error('KMS public key is not an uncompressed secp256k1 point.');
        }

        this.cachedAddress = computeAddress(hexlify(uncompressedPoint));

        return this.cachedAddress;
    }

    /** Sign a 32-byte digest, returning a full Ethereum signature with parity. */
    private async signDigest(digest: Uint8Array): Promise<Signature> {
        const digestBuffer = Buffer.from(digest);

        if (digestBuffer.length !== 32) {
            throw new Error('Digest must be exactly 32 bytes.');
        }

        const [response] = await kmsClient().asymmetricSign({
            name: this.keyVersionName,
            digest: { sha256: digestBuffer },
            digestCrc32c: { value: crc32c(digestBuffer) }
        });

        if (!response.signature) {
            throw new Error('KMS returned an empty signature.');
        }

        if (response.verifiedDigestCrc32c !== true) {
            throw new Error('KMS did not verify the digest checksum; the request was corrupted in transit.');
        }

        const derSignature = Buffer.from(response.signature as Uint8Array);

        if (response.signatureCrc32c) {
            const expected = Number((response.signatureCrc32c as { value?: unknown }).value ?? response.signatureCrc32c);

            if (Number.isFinite(expected) && crc32c(derSignature) !== expected) {
                throw new Error('KMS signature failed CRC32C verification.');
            }
        }

        const { r } = parseDerSignature(derSignature);
        let { s } = parseDerSignature(derSignature);

        // EIP-2: a signature with high s is equally valid mathematically but is
        // rejected by Ethereum clients as malleable.
        if (s > HALF_N) {
            s = SECP256K1_N - s;
        }

        const expectedAddress = await this.getAddress();

        for (const yParity of [0, 1] as const) {
            const candidate = Signature.from({ r: toHex32(r), s: toHex32(s), yParity });

            if (recoverAddress(digest, candidate) === expectedAddress) {
                return candidate;
            }
        }

        throw new Error('Could not recover the signer address from the KMS signature.');
    }

    async signTransaction(tx: TransactionRequest): Promise<string> {
        const populated = await this.populateTransaction(tx);

        // `from` is implied by the signature and is not part of the serialised
        // payload; ethers rejects it being present.
        delete (populated as { from?: unknown }).from;

        const transaction = Transaction.from(populated as never);
        transaction.signature = await this.signDigest(getBytes(transaction.unsignedHash));

        return transaction.serialized;
    }

    async signMessage(message: string | Uint8Array): Promise<string> {
        const signature = await this.signDigest(getBytes(hashMessage(message)));
        return signature.serialized;
    }

    async signTypedData(
        domain: TypedDataDomain,
        types: Record<string, Array<TypedDataField>>,
        value: Record<string, unknown>
    ): Promise<string> {
        const digest = TypedDataEncoder.hash(domain, types, value);
        const signature = await this.signDigest(getBytes(digest));

        return signature.serialized;
    }
}
