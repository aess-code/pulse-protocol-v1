const { ethers } = require("hardhat");

// Deployed addresses from Phase 4B deployment
const DEPLOYED = {
  PriceEngine:        "0x70A91100f52D09b021ba28B607A534ED94e3986d",
  MarketVaultFactory: "0x9F9d076cdE441EeCeD011CAF0F18f2a3a48274A8",
  TradingEngine:      "0xa6EE88f610140c9934153fC0d3549930a8f60B91",
  FeeManager:         "0xE15FF88dB39740a7B9E46e69712F0Ad4a288dbe7",
  SettlementManager:  "0xB73abD77372FcD9E2Ca1D93d64A5d8163F24cC1e",
  PulseFactory:       "0x0e7592aF466DE837B700a97909E73cDF74E26D93",
};

async function main() {
  console.log("=== Pulse V1 Post-Deployment Verification ===\n");

  // Verify PulseFactory immutable links
  const pf = await ethers.getContractAt("PulseFactory", DEPLOYED.PulseFactory);
  const te = await ethers.getContractAt("TradingEngine", DEPLOYED.TradingEngine);
  const fm = await ethers.getContractAt("FeeManager", DEPLOYED.FeeManager);
  const mvf = await ethers.getContractAt("MarketVaultFactory", DEPLOYED.MarketVaultFactory);
  const sm = await ethers.getContractAt("SettlementManager", DEPLOYED.SettlementManager);

  const checks = [
    { name: "PulseFactory.tradingEngine()",       actual: await pf.tradingEngine(),               expected: DEPLOYED.TradingEngine },
    { name: "PulseFactory.feeManager()",          actual: await pf.feeManager(),                  expected: DEPLOYED.FeeManager },
    { name: "PulseFactory.settlementManager()",   actual: await pf.settlementManager(),            expected: DEPLOYED.SettlementManager },
    { name: "PulseFactory.vaultFactory()",        actual: await pf.vaultFactory(),                 expected: DEPLOYED.MarketVaultFactory },
    { name: "TradingEngine.factory()",            actual: await te.factory(),                      expected: DEPLOYED.PulseFactory },
    { name: "TradingEngine.feeManager()",         actual: await te.feeManager(),                   expected: DEPLOYED.FeeManager },
    { name: "TradingEngine.priceEngine()",        actual: await te.priceEngine(),                  expected: DEPLOYED.PriceEngine },
    { name: "FeeManager.authorizedTradingEngine()",actual: await fm.authorizedTradingEngine(),     expected: DEPLOYED.TradingEngine },
    { name: "FeeManager.factory()",               actual: await fm.factory(),                      expected: DEPLOYED.PulseFactory },
    { name: "MarketVaultFactory.authorizedFactory()",actual: await mvf.authorizedFactory(),        expected: DEPLOYED.PulseFactory },
    { name: "SettlementManager.tradingEngine()",  actual: await sm.tradingEngine(),                expected: DEPLOYED.TradingEngine },
    { name: "SettlementManager.factory()",        actual: await sm.factory(),                      expected: DEPLOYED.PulseFactory },
  ];

  let allPass = true;
  for (const check of checks) {
    const pass = check.actual.toLowerCase() === check.expected.toLowerCase();
    if (!pass) allPass = false;
    console.log(`${pass ? "PASS" : "FAIL"} | ${check.name}`);
    if (!pass) {
      console.log(`       Expected: ${check.expected}`);
      console.log(`       Actual:   ${check.actual}`);
    }
  }

  // Verify economic parameters
  const minLiq = await pf.MIN_INITIAL_LIQUIDITY();
  const token  = await pf.settlementToken();
  const treasury = await fm.treasury();
  const team     = await fm.team();

  console.log("\n=== Economic Parameters ===");
  console.log("MIN_INITIAL_LIQUIDITY:", minLiq.toString());
  console.log("Settlement Token:     ", token);
  console.log("Treasury:             ", treasury);
  console.log("Team:                 ", team);

  console.log("\n=== Result ===");
  console.log(allPass ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
