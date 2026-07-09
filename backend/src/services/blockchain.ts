import { ethers } from 'ethers';
// Using hardcoded ABI for prototype to avoid complex imports between workspaces
const KYCVaultABI = [
  "function verifyKYC(string memory customerId, string memory payloadHash) external",
  "function grantConsent(string memory customerId, address partnerBank) external",
  "function checkStatus(string memory customerId, address partnerBank) external view returns (bool hasConsent, string memory payloadHash, uint256 verifiedAt, address verifierBank)"
];

// For hackathon, default to localhost hardhat node
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
const contractAddress = process.env.CONTRACT_ADDRESS || "";

export async function verifyKYCOnChain(customerId: string, payloadHash: string, bankPrivateKey: string) {
    const wallet = new ethers.Wallet(bankPrivateKey, provider);
    const contract = new ethers.Contract(contractAddress, KYCVaultABI, wallet);
    
    const tx = await contract.verifyKYC(customerId, payloadHash);
    await tx.wait();
    return tx.hash;
}

export async function grantConsentOnChain(customerId: string, partnerBankAddress: string, customerPrivateKey: string) {
    const wallet = new ethers.Wallet(customerPrivateKey, provider);
    const contract = new ethers.Contract(contractAddress, KYCVaultABI, wallet);
    
    const tx = await contract.grantConsent(customerId, partnerBankAddress);
    await tx.wait();
    return tx.hash;
}

export async function checkStatusOnChain(customerId: string, partnerBankAddress: string) {
    const contract = new ethers.Contract(contractAddress, KYCVaultABI, provider);
    const result = await contract.checkStatus(customerId, partnerBankAddress);
    return {
        hasConsent: result.hasConsent,
        payloadHash: result.payloadHash,
        verifiedAt: Number(result.verifiedAt),
        verifierBank: result.verifierBank
    };
}
