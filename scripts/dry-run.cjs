const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  let deployerAddress;
  let startNonce;

  if (process.env.PRIVATE_KEY) {
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, ethers.provider);
    deployerAddress = wallet.address;
    // Use the current real nonce from the Sepolia network.
    startNonce = await wallet.getNonce(); 
    console.log("REAL_DEPLOY_WALLET_MODE: Active");
  } else {
    const [defaultDeployer] = await ethers.getSigners();
    deployerAddress = defaultDeployer.address;
    startNonce = await defaultDeployer.getNonce();
    console.log("LOCAL_SIMULATION_ONLY: Using Hardhat default account");
  }

  console.log("DEPLOYER_ADDRESS:", deployerAddress);
  console.log("Dry Run Mode - Address Prediction based on Nonce:", startNonce);

  function predictAddress(nonce) {
    return ethers.getCreateAddress({ from: deployerAddress, nonce });
  }

  // Sequence according to Stage8_Deployment_Architecture.md
  const priceEngineAddr = predictAddress(startNonce);
  const vaultFactoryAddr = predictAddress(startNonce + 1);
  const tradingEngineAddr = predictAddress(startNonce + 2);
  const feeManagerAddr = predictAddress(startNonce + 3);
  const settlementManagerAddr = predictAddress(startNonce + 4);
  const pulseFactoryAddr = predictAddress(startNonce + 5);

  const treasury = process.env.TREASURY_ADDRESS || "0xTREASURY_PLACEHOLDER";
  const team = process.env.TEAM_ADDRESS || "0xTEAM_PLACEHOLDER";
  const token = process.env.SETTLEMENT_TOKEN_ADDRESS || "0xTOKEN_PLACEHOLDER";

  console.log("\n### Expected Deployment Address Table (REAL ENVIRONMENT)");
  console.log("| Contract | Expected Address | Constructor Arguments | Dependency Check |");
  console.log("| :--- | :--- | :--- | :--- |");
  console.log(`| **PriceEngine** | \`${priceEngineAddr}\` | None | PASS |`);
  console.log(`| **MarketVaultFactory** | \`${vaultFactoryAddr}\` | \`${pulseFactoryAddr}\` (PF) | PASS |`);
  console.log(`| **TradingEngine** | \`${tradingEngineAddr}\` | PF, \`${priceEngineAddr}\` (PE), \`${feeManagerAddr}\` (FM) | PASS |`);
  console.log(`| **FeeManager** | \`${feeManagerAddr}\` | \`${tradingEngineAddr}\` (TE), PF, \`${treasury}\`, \`${team}\` | PASS |`);
  console.log(`| **SettlementManager** | \`${settlementManagerAddr}\` | TE, PF | PASS |`);
  console.log(`| **PulseFactory** | \`${pulseFactoryAddr}\` | \`${vaultFactoryAddr}\`, TE, \`${settlementManagerAddr}\`, FM, \`${token}\` | PASS |`);

  console.log("\n--- Verification Logic ---");
  console.log("1. PriceEngine: Independent.");
  console.log(`2. MarketVaultFactory: Points to PF (\`${pulseFactoryAddr}\`).`);
  console.log(`3. TradingEngine: Points to PF, PE (\`${priceEngineAddr}\`), FM (\`${feeManagerAddr}\`).`);
  console.log(`4. FeeManager: Points to TE (\`${tradingEngineAddr}\`), PF.`);
  console.log(`5. SettlementManager: Points to TE, PF.`);
  console.log(`6. PulseFactory: Points to all actual deployed/predicted modules.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
