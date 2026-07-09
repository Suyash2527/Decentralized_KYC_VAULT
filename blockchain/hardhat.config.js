require("@nomicfoundation/hardhat-toolbox");

const PRIVATE_KEY = "80ef6f28c5e5a162d74d8c48dd9cd2805929893771ece2b061f9ad7a945c6a5e";
const SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.19",
  networks: {
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: [PRIVATE_KEY]
    }
  }
};
