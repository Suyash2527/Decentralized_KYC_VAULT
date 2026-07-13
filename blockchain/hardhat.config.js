require("@nomicfoundation/hardhat-toolbox");

try {
  require("dotenv").config();
} catch (error) {
  // Allow local test and CI runs without dotenv installed.
}

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
const SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.19",
  networks: {
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    }
  }
};
