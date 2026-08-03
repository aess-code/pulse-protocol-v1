require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: {
    compilers: [
      { 
        version: "0.8.24", 
        settings: { 
          optimizer: { enabled: true, runs: 200 }, 
          evmVersion: "cancun",
          viaIR: true 
        } 
      }
    ],
  },
  paths: {
    sources:   "./contracts",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    hardhat: {
      // For local testing and dry run
      chainId: 31337,
    },
  },
};
