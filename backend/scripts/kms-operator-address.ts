import 'dotenv/config';
import { KmsSigner } from '../src/services/kmsSigner';

/**
 * Prints the Ethereum address controlled by the Cloud KMS signing key.
 *
 * You need this before deploying KYCVault.sol, because the contract's
 * `operator` is set in the constructor and is immutable. Deploy with this
 * address as the constructor argument and the HSM key becomes the only thing
 * that can call verifyKYC, grantConsent or revokeConsent.
 *
 *   npm run kms:address
 */
async function main(): Promise<void> {
    const signer = new KmsSigner();
    const address = await signer.getAddress();

    console.log('');
    console.log('  KMS key version : ' + signer.keyVersionName);
    console.log('  Operator address: ' + address);
    console.log('');
    console.log('  Fund this address with Sepolia ETH, then deploy the contract with');
    console.log('  it as the constructor argument.');
    console.log('');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
