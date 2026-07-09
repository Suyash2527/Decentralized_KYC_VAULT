const hre = require("hardhat");

async function main() {
  const KYCVault = await hre.ethers.getContractFactory("KYCVault");
  const kycVault = await KYCVault.deploy();

  await kycVault.waitForDeployment();

  console.log(`KYCVault deployed to: ${await kycVault.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
