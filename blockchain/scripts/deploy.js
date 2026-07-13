const hre = require("hardhat");

async function main() {
  const KYCVault = await hre.ethers.getContractFactory("KYCVault");
  const [deployer] = await hre.ethers.getSigners();
  const kycVault = await KYCVault.deploy(deployer.address);

  await kycVault.waitForDeployment();

  console.log(`KYCVault deployed to: ${await kycVault.getAddress()}`);
  console.log(`KYCVault operator: ${deployer.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
