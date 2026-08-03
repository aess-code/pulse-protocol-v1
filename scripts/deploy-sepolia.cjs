const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  const balance = await deployer.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  const startNonce = await deployer.getNonce();
  console.log("Starting Nonce:", startNonce);

  function predictAddress(nonce) {
    return ethers.getCreateAddress({ from: deployer.address, nonce });
  }

  // Predict addresses for circular dependencies
  const priceEngineAddr = predictAddress(startNonce);
  const vaultFactoryAddr = predictAddress(startNonce + 1);
  const tradingEngineAddr = predictAddress(startNonce + 2);
  const feeManagerAddr = predictAddress(startNonce + 3);
  const settlementManagerAddr = predictAddress(startNonce + 4);
  const pulseFactoryAddr = predictAddress(startNonce + 5);

  console.log("\n--- Predicted Addresses ---");
  console.log("PriceEngine:", priceEngineAddr);
  console.log("MarketVaultFactory:", vaultFactoryAddr);
  console.log("TradingEngine:", tradingEngineAddr);
  console.log("FeeManager:", feeManagerAddr);
  console.log("SettlementManager:", settlementManagerAddr);
  console.log("PulseFactory:", pulseFactoryAddr);

  // 1. Deploy PriceEngine
  console.log("\nDeploying PriceEngine...");
  const PriceEngine = await ethers.getContractFactory("PriceEngine");
  const priceEngine = await PriceEngine.deploy();
  await priceEngine.waitForDeployment();
  console.log("PriceEngine actual address:", await priceEngine.getAddress());

  // 2. Deploy MarketVaultFactory
  console.log("Deploying MarketVaultFactory...");
  const MarketVaultFactory = await ethers.getContractFactory("MarketVaultFactory");
  const marketVaultFactory = await MarketVaultFactory.deploy(pulseFactoryAddr);
  await marketVaultFactory.waitForDeployment();
  console.log("MarketVaultFactory actual address:", await marketVaultFactory.getAddress());

  // 3. Deploy TradingEngine
  console.log("Deploying TradingEngine...");
  const TradingEngine = await ethers.getContractFactory("TradingEngine");
  const tradingEngine = await TradingEngine.deploy(
    pulseFactoryAddr,
    priceEngineAddr,
    feeManagerAddr
  );
  await tradingEngine.waitForDeployment();
  console.log("TradingEngine actual address:", await tradingEngine.getAddress());

  // 4. Deploy FeeManager
  const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || deployer.address;
  const TEAM_ADDRESS = process.env.TEAM_ADDRESS || deployer.address;
  console.log("Deploying FeeManager...");
  const FeeManager = await ethers.getContractFactory("FeeManager");
  const feeManager = await FeeManager.deploy(
    tradingEngineAddr,
    pulseFactoryAddr,
    TREASURY_ADDRESS,
    TEAM_ADDRESS
  );
  await feeManager.waitForDeployment();
  console.log("FeeManager actual address:", await feeManager.getAddress());

  // 5. Deploy SettlementManager
  console.log("Deploying SettlementManager...");
  const SettlementManager = await ethers.getContractFactory("SettlementManager");
  const settlementManager = await SettlementManager.deploy(
    tradingEngineAddr,
    pulseFactoryAddr
  );
  await settlementManager.waitForDeployment();
  console.log("SettlementManager actual address:", await settlementManager.getAddress());

  // 6. Deploy PulseFactory
  const SETTLEMENT_TOKEN_ADDRESS = process.env.SETTLEMENT_TOKEN_ADDRESS || "0x" + "0".repeat(40);
  const MIN_INITIAL_LIQUIDITY = 100_000_000n; // 100 MockUSDT (6 decimals)
  console.log("Deploying PulseFactory...");
  console.log("  Settlement Token:", SETTLEMENT_TOKEN_ADDRESS);
  console.log("  MIN_INITIAL_LIQUIDITY:", MIN_INITIAL_LIQUIDITY.toString());
  const PulseFactory = await ethers.getContractFactory("PulseFactory");
  const pulseFactory = await PulseFactory.deploy(
    vaultFactoryAddr,
    tradingEngineAddr,
    settlementManagerAddr,
    feeManagerAddr,
    SETTLEMENT_TOKEN_ADDRESS,
    MIN_INITIAL_LIQUIDITY
  );
  await pulseFactory.waitForDeployment();
  console.log("PulseFactory actual address:", await pulseFactory.getAddress());

  console.log("\n--- Deployment Complete ---");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
