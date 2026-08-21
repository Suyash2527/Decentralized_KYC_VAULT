import { ethers } from 'ethers';
import { KmsSigner } from './kmsSigner';

const KYCVaultABI = [
    'function verifyKYC(string customerId, bytes32 payloadHash) external',
    'function grantConsent(string customerId, bytes32 partnerIdHash) external',
    'function revokeConsent(string customerId, bytes32 partnerIdHash) external',
    'function checkStatus(string customerId, bytes32 partnerIdHash) external view returns (bool hasConsent, bool isVerified, bytes32 payloadHash, uint256 verifiedAt, address verifierBank)'
];

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://127.0.0.1:8545');

// Every write is signed by the single operator key, so two concurrent requests
// would otherwise read the same nonce and one would fail with NONCE_EXPIRED.
// Broadcasts are serialised through this chain and the nonce is tracked locally;
// confirmation waiting happens outside the lock so throughput is not blocked by
// a 12s block time.
let broadcastQueue: Promise<unknown> = Promise.resolve();
let nextNonce: number | null = null;

const WAIT_FOR_CONFIRMATION = process.env.WAIT_FOR_CONFIRMATION !== 'false';

function requireEnv(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`${name} environment variable is required.`);
    }

    return value;
}

function getContractAddress(): string {
    return requireEnv('CONTRACT_ADDRESS');
}

// The operator key lives in Cloud KMS and is never exported. If a raw private
// key is still present in the environment (local development, or the window
// between deploying this code and completing the operator handover) it is used
// as a fallback and logged loudly, because it is the weaker configuration.
let cachedSigner: ethers.Signer | null = null;
let warnedAboutRawKey = false;

function getSigner(): ethers.Signer {
    if (cachedSigner) {
        return cachedSigner;
    }

    const rawKey = process.env.DEPLOYER_PRIVATE_KEY;

    if (process.env.KMS_SIGNING_KEY) {
        cachedSigner = new KmsSigner(provider);
        return cachedSigner;
    }

    if (!rawKey) {
        throw new Error('Configure KMS_SIGNING_KEY (preferred) or DEPLOYER_PRIVATE_KEY.');
    }

    if (!warnedAboutRawKey) {
        warnedAboutRawKey = true;
        console.warn(
            '[security] Signing with a raw DEPLOYER_PRIVATE_KEY from the environment. ' +
            'This key is readable by anything that can read this process. ' +
            'Set KMS_SIGNING_KEY to move signing into Cloud KMS.'
        );
    }

    cachedSigner = new ethers.Wallet(rawKey, provider);
    return cachedSigner;
}

/** Ethereum address of whatever signer is configured. Logged at boot. */
export async function getOperatorAddress(): Promise<string> {
    return getSigner().getAddress();
}

function getWriteContract() {
    return new ethers.Contract(getContractAddress(), KYCVaultABI, getSigner());
}

function getReadContract() {
    return new ethers.Contract(getContractAddress(), KYCVaultABI, provider);
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = broadcastQueue.then(task, task);
    broadcastQueue = result.catch(() => undefined);
    return result;
}

async function broadcast(
    send: (contract: ethers.Contract, overrides: { nonce: number }) => Promise<ethers.ContractTransactionResponse>
): Promise<string> {
    const transaction = await enqueue(async () => {
        const contract = getWriteContract();

        if (nextNonce === null) {
            const address = await getSigner().getAddress();
            nextNonce = await provider.getTransactionCount(address, 'pending');
        }

        try {
            const tx = await send(contract, { nonce: nextNonce });
            nextNonce += 1;
            return tx;
        } catch (error) {
            // Resynchronise with the chain on the next call rather than
            // carrying a nonce that may now be wrong.
            nextNonce = null;
            throw error;
        }
    });

    if (WAIT_FOR_CONFIRMATION) {
        await transaction.wait();
    }

    return transaction.hash;
}

export function normalizePartnerId(partnerId: string): string {
    return partnerId.trim().toLowerCase();
}

function toPartnerHash(partnerId: string): string {
    return ethers.id(normalizePartnerId(partnerId));
}

export async function verifyKYCOnChain(customerId: string, payloadHash: string) {
    return broadcast((contract, overrides) => contract.verifyKYC(customerId, payloadHash, overrides));
}

export async function grantConsentOnChain(customerId: string, partnerId: string) {
    return broadcast((contract, overrides) => contract.grantConsent(customerId, toPartnerHash(partnerId), overrides));
}

export async function revokeConsentOnChain(customerId: string, partnerId: string) {
    return broadcast((contract, overrides) => contract.revokeConsent(customerId, toPartnerHash(partnerId), overrides));
}

export async function checkStatusOnChain(customerId: string, partnerId: string) {
    const contract = getReadContract();
    const result = await contract.checkStatus(customerId, toPartnerHash(partnerId));

    return {
        hasConsent: result.hasConsent,
        isVerified: result.isVerified,
        payloadHash: String(result.payloadHash).toLowerCase(),
        verifiedAt: Number(result.verifiedAt),
        verifierBank: result.verifierBank
    };
}
