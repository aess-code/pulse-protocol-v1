const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying MockUSDT with the account:", deployer.address);

  const balance = await deployer.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  const MockUSDT = await ethers.getContractFactory("MockUSDT");
  const mockUSDT = await MockUSDT.deploy();
  await mockUSDT.waitForDeployment();

  const address = await mockUSDT.getAddress();
  console.log("MockUSDT deployed to:", address);
  console.log("Token Name:", await mockUSDT.name());
  console.log("Token Symbol:", await mockUSDT.symbol());
  console.log("Decimals:", await mockUSDT.decimals());

  console.log("\nUpdate your .env file with:");
  console.log(`SETTLEMENT_TOKEN_ADDRESS="${address}"`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
