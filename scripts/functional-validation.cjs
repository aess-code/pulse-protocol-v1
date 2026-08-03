const { ethers } = require("hardhat");

// Deployed contract addresses (Phase 4B)
const ADDR = {
  PriceEngine:        "0x70A91100f52D09b021ba28B607A534ED94e3986d",
  MarketVaultFactory: "0x9F9d076cdE441EeCeD011CAF0F18f2a3a48274A8",
  TradingEngine:      "0xa6EE88f610140c9934153fC0d3549930a8f60B91",
  FeeManager:         "0xE15FF88dB39740a7B9E46e69712F0Ad4a288dbe7",
  SettlementManager:  "0xB73abD77372FcD9E2Ca1D93d64A5d8163F24cC1e",
  PulseFactory:       "0x0e7592aF466DE837B700a97909E73cDF74E26D93",
  MockUSDT:           "0xDE92b9aF7FCd57ad660d7098C6a125D6594aA243",
};

const RESULTS = [];

function log(label, value, pass) {
  const status = pass === undefined ? "INFO" : (pass ? "PASS" : "FAIL");
  const line = `[${status}] ${label}: ${value}`;
  console.log(line);
  RESULTS.push({ status, label, value });
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("=== Pulse V1 Sepolia Functional Validation ===");
  console.log("Validator address:", deployer.address);

  // Attach contracts
  const pf  = await ethers.getContractAt("PulseFactory", ADDR.PulseFactory);
  const te  = await ethers.getContractAt("TradingEngine", ADDR.TradingEngine);
  const usdt = await ethers.getContractAt("MockUSDT", ADDR.MockUSDT);

  // ── Step 1: Mint MockUSDT ──────────────────────────────────────────────────
  console.log("\n--- Step 1: Mint MockUSDT ---");
  const mintAmount = 1_000_000_000n; // 1000 USDT (6 decimals)
  const mintTx = await usdt.mint(deployer.address, mintAmount);
  await mintTx.wait();
  const balance = await usdt.balanceOf(deployer.address);
  log("MockUSDT balance after mint", `${balance.toString()} (${Number(balance) / 1e6} USDT)`, balance >= mintAmount);

  // ── Step 2: Create View ────────────────────────────────────────────────────
  console.log("\n--- Step 2: Create View (createView) ---");
  const initialLiquidity = 100_000_000n; // 100 USDT each side
  const totalLiquidity   = initialLiquidity * 2n;

  // Approve PulseFactory to pull total liquidity
  const approveTx = await usdt.approve(ADDR.PulseFactory, totalLiquidity);
  await approveTx.wait();
  log("Approve PulseFactory", `${totalLiquidity.toString()} approved`, true);

  // Create a FIXED view with 90 minutes minimum duration
  const now       = BigInt(Math.floor(Date.now() / 1000));
  const startTime = now;
  const endTime   = now + 7200n; // 2 hours from now

  const createTx = await pf.createView(
    0,                          // ViewType.FIXED = 0
    "ipfs://QmPulseV1TestView", // metadataURI
    ethers.keccak256(ethers.toUtf8Bytes("pulse-v1-test")), // metadataHash
    startTime,
    endTime,
    initialLiquidity,           // YES liquidity
    initialLiquidity            // NO liquidity (50/50)
  );
  const createReceipt = await createTx.wait();

  // Parse ViewCreated event
  const viewCreatedEvent = createReceipt.logs
    .map(l => { try { return pf.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === "ViewCreated");

  const viewId = viewCreatedEvent ? viewCreatedEvent.args.viewId : null;
  log("ViewCreated event", viewId ? `viewId = ${viewId}` : "NOT FOUND", !!viewId);

  if (!viewId) {
    console.error("CRITICAL: ViewCreated event not found. Aborting.");
    process.exit(1);
  }

  // ── Step 3: Verify Initial State ──────────────────────────────────────────
  console.log("\n--- Step 3: Verify Initial Market State ---");
  const state = await te.marketStates(viewId);

  log("Initial forSupply (YES shares)",    state.forSupply.toString(),    true);
  log("Initial againstSupply (NO shares)", state.againstSupply.toString(), true);
  log("Initial reserveBalance",            state.reserveBalance.toString(), true);
  log("Initial lastPulseIndex",            state.lastPulseIndex.toString(), true);

  // Verify 50/50 invariant
  const fiftyFifty = state.forSupply === state.againstSupply;
  log("50/50 Invariant (forSupply == againstSupply)", fiftyFifty.toString(), fiftyFifty);

  // Verify shares = liquidity * 2
  const expectedShares = initialLiquidity * 2n;
  const sharesCorrect = state.forSupply === expectedShares;
  log("Shares Formula (shares == liquidity * 2)", `${state.forSupply} == ${expectedShares}`, sharesCorrect);

  // Verify INITIAL_INDEX = 5000
  const indexCorrect = state.lastPulseIndex === 5000n;
  log("INITIAL_INDEX == 5000", state.lastPulseIndex.toString(), indexCorrect);

  // Verify reserveBalance = total liquidity
  const reserveCorrect = state.reserveBalance === totalLiquidity;
  log("reserveBalance == totalLiquidity", `${state.reserveBalance} == ${totalLiquidity}`, reserveCorrect);

  // ── Step 4: Buy ────────────────────────────────────────────────────────────
  console.log("\n--- Step 4: Buy (side=0 FOR, 10 USDT gross) ---");
  const buyAmount = 10_000_000n; // 10 USDT
  const approveBuyTx = await usdt.approve(ADDR.TradingEngine, buyAmount);
  await approveBuyTx.wait();

  const buyTx = await te.buy(viewId, 0, buyAmount, 0n); // side=0 (FOR), minSharesOut=0
  const buyReceipt = await buyTx.wait();

  const boughtEvent = buyReceipt.logs
    .map(l => { try { return te.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === "Bought");

  const sharesOut = boughtEvent ? boughtEvent.args.sharesOut : null;
  log("Buy Bought event", sharesOut ? `sharesOut = ${sharesOut}` : "NOT FOUND", !!sharesOut);

  const stateAfterBuy = await te.marketStates(viewId);
  log("reserveBalance after buy", stateAfterBuy.reserveBalance.toString(), stateAfterBuy.reserveBalance > totalLiquidity);
  log("lastPulseIndex after buy", stateAfterBuy.lastPulseIndex.toString(), true);

  // Verify solvency: min(F,A) <= R
  const minSupply = stateAfterBuy.forSupply < stateAfterBuy.againstSupply
    ? stateAfterBuy.forSupply : stateAfterBuy.againstSupply;
  const solvencyOk = minSupply <= stateAfterBuy.reserveBalance;
  log("Solvency Invariant (min(F,A) <= R)", `min(${stateAfterBuy.forSupply},${stateAfterBuy.againstSupply})=${minSupply} <= ${stateAfterBuy.reserveBalance}`, solvencyOk);

  // ── Step 5: Sell ───────────────────────────────────────────────────────────
  console.log("\n--- Step 5: Sell (side=0 FOR, half of shares) ---");
  const position = await te.positions(viewId, deployer.address);
  const sellShares = position.forShares / 2n;
  log("Current forShares position", position.forShares.toString(), true);

  const sellTx = await te.sell(viewId, 0, sellShares, 0n); // side=0, minAmountOut=0
  const sellReceipt = await sellTx.wait();

  const soldEvent = sellReceipt.logs
    .map(l => { try { return te.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === "Sold");

  const amountOut = soldEvent ? soldEvent.args.amountOut : null;
  log("Sell Sold event", amountOut ? `amountOut = ${amountOut}` : "NOT FOUND", !!amountOut);

  const stateAfterSell = await te.marketStates(viewId);
  log("reserveBalance after sell", stateAfterSell.reserveBalance.toString(), stateAfterSell.reserveBalance < stateAfterBuy.reserveBalance);

  // Final solvency check
  const minSupplyFinal = stateAfterSell.forSupply < stateAfterSell.againstSupply
    ? stateAfterSell.forSupply : stateAfterSell.againstSupply;
  const solvencyFinal = minSupplyFinal <= stateAfterSell.reserveBalance;
  log("Solvency Invariant after sell", `min(F,A)=${minSupplyFinal} <= R=${stateAfterSell.reserveBalance}`, solvencyFinal);

  // ── Step 6: Position Accounting ───────────────────────────────────────────
  console.log("\n--- Step 6: Position Accounting ---");
  const finalPosition = await te.positions(viewId, deployer.address);
  log("Final forShares", finalPosition.forShares.toString(), true);
  log("Final againstShares", finalPosition.againstShares.toString(), true);

  // ── Summary ────────────────────────────────────────────────────────────────
  const passed = RESULTS.filter(r => r.status === "PASS").length;
  const failed = RESULTS.filter(r => r.status === "FAIL").length;
  console.log(`\n=== SUMMARY: ${passed} PASS / ${failed} FAIL ===`);

  // Output JSON for report generation
  const reportData = {
    viewId: viewId.toString(),
    initialState: {
      forSupply:    state.forSupply.toString(),
      againstSupply: state.againstSupply.toString(),
      reserveBalance: state.reserveBalance.toString(),
      lastPulseIndex: state.lastPulseIndex.toString(),
    },
    afterBuy: {
      reserveBalance: stateAfterBuy.reserveBalance.toString(),
      lastPulseIndex: stateAfterBuy.lastPulseIndex.toString(),
      sharesOut: sharesOut ? sharesOut.toString() : "N/A",
    },
    afterSell: {
      reserveBalance: stateAfterSell.reserveBalance.toString(),
      lastPulseIndex: stateAfterSell.lastPulseIndex.toString(),
      amountOut: amountOut ? amountOut.toString() : "N/A",
    },
    checks: RESULTS,
    summary: { passed, failed },
  };
  console.log("\n=== REPORT_DATA_JSON ===");
  console.log(JSON.stringify(reportData, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
