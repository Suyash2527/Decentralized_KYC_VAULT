import { ethers } from 'ethers';

const KYCVaultABI = [
    'function verifyKYC(string customerId, bytes32 payloadHash) external',
    'function grantConsent(string customerId, bytes32 partnerIdHash) external',
    'function revokeConsent(string customerId, bytes32 partnerIdHash) external',
    'function checkStatus(string customerId, bytes32 partnerIdHash) external view returns (bool hasConsent, bool isVerified, bytes32 payloadHash, uint256 verifiedAt, address verifierBank)'
];

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://127.0.0.1:8545');

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

function getSigner() {
    const privateKey = requireEnv('DEPLOYER_PRIVATE_KEY');
    return new ethers.Wallet(privateKey, provider);
}

function getWriteContract() {
    return new ethers.Contract(getContractAddress(), KYCVaultABI, getSigner());
}

function getReadContract() {
    return new ethers.Contract(getContractAddress(), KYCVaultABI, provider);
}

export function normalizePartnerId(partnerId: string): string {
    return partnerId.trim().toLowerCase();
}

function toPartnerHash(partnerId: string): string {
    return ethers.id(normalizePartnerId(partnerId));
}

export async function verifyKYCOnChain(customerId: string, payloadHash: string) {
    const contract = getWriteContract();
    const tx = await contract.verifyKYC(customerId, payloadHash);
    await tx.wait();

    return tx.hash;
}

export async function grantConsentOnChain(customerId: string, partnerId: string) {
    const contract = getWriteContract();
    const tx = await contract.grantConsent(customerId, toPartnerHash(partnerId));
    await tx.wait();

    return tx.hash;
}

export async function revokeConsentOnChain(customerId: string, partnerId: string) {
    const contract = getWriteContract();
    const tx = await contract.revokeConsent(customerId, toPartnerHash(partnerId));
    await tx.wait();

    return tx.hash;
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
