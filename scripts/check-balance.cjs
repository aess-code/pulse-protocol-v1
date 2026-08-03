const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const nonce = await ethers.provider.getTransactionCount(deployer.address);
  console.log("Deployer Address:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  console.log("Nonce:", nonce);
  
  if (balance < ethers.parseEther("0.01")) {
    console.log("WARNING: Balance may be insufficient for deployment. Please fund the wallet with Sepolia ETH.");
  } else {
    console.log("Balance sufficient for deployment.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
