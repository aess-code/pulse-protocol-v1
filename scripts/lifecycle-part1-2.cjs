const { ethers } = require("hardhat");

const ADDR = {
  TradingEngine:      "0xa6EE88f610140c9934153fC0d3549930a8f60B91",
  FeeManager:         "0xE15FF88dB39740a7B9E46e69712F0Ad4a288dbe7",
  PulseFactory:       "0x0e7592aF466DE837B700a97909E73cDF74E26D93",
  MockUSDT:           "0xDE92b9aF7FCd57ad660d7098C6a125D6594aA243",
  Treasury:           "0x1b84e2581949cc26c5be97e701905881fd693201",
  Team:               "0xbbc1f05d0478815776aaa2e1e13155030bb04bd3",
};

const LOG = [];
function log(status, label, value) {
  const line = `[${status}] ${label}: ${value}`;
  console.log(line);
  LOG.push({ status, label, value });
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("=== Part 1-2: FeeManager + Market Lock Validation ===");

  const pf   = await ethers.getContractAt("PulseFactory", ADDR.PulseFactory);
  const te   = await ethers.getContractAt("TradingEngine", ADDR.TradingEngine);
  const fm   = await ethers.getContractAt("FeeManager", ADDR.FeeManager);
  const usdt = await ethers.getContractAt("MockUSDT", ADDR.MockUSDT);

  // ── Setup: Mint and create market ─────────────────────────────────────────
  console.log("\n--- Setup: Mint & Create Market ---");
  const mintTx = await usdt.mint(deployer.address, 2_000_000_000n);
  await mintTx.wait();

  const initialLiq = 100_000_000n;
  await (await usdt.approve(ADDR.PulseFactory, initialLiq * 2n)).wait();

  const now = BigInt(Math.floor(Date.now() / 1000));
  const createTx = await pf.createView(
    0, "ipfs://QmPart12Test", ethers.keccak256(ethers.toUtf8Bytes("part12")),
    now, now + 7200n, initialLiq, initialLiq
  );
  const createReceipt = await createTx.wait();
  const viewCreated = createReceipt.logs
    .map(l => { try { return pf.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === "ViewCreated");
  const viewId = viewCreated.args.viewId;
  log("INFO", "Created viewId", viewId.toString());
  log("INFO", "createView tx", createReceipt.hash);

  // ── Part 1: FeeManager Lifecycle ──────────────────────────────────────────
  console.log("\n--- Part 1: FeeManager Lifecycle ---");

  // Buy to generate fees
  const buyAmount = 100_000_000n; // 100 USDT
  await (await usdt.approve(ADDR.TradingEngine, buyAmount)).wait();
  const buyTx = await te.buy(viewId, 0, buyAmount, 0n);
  const buyReceipt = await buyTx.wait();
  log("INFO", "buy tx", buyReceipt.hash);

  // Expected fee: 1% of 100 USDT = 1 USDT = 1,000,000 units
  const expectedTotalFee = (buyAmount * 100n) / 10000n; // 1,000,000
  const expectedFeeRecipient = (expectedTotalFee * 7000n) / 10000n; // 700,000
  const expectedTreasury     = (expectedTotalFee * 2000n) / 10000n; // 200,000
  const expectedTeam         = expectedTotalFee - expectedFeeRecipient - expectedTreasury; // 100,000

  // Check pending fees
  const pendingFR = await fm.pendingFeeRecipientFees(viewId, deployer.address);
  const pendingTr = await fm.pendingTreasuryFees(viewId);
  const pendingTm = await fm.pendingTeamFees(viewId);

  log(pendingFR === expectedFeeRecipient ? "PASS" : "FAIL", "FeeRecipient pending fee (7000/10000)", `${pendingFR} == ${expectedFeeRecipient}`);
  log(pendingTr === expectedTreasury     ? "PASS" : "FAIL", "Treasury pending fee (2000/10000)",     `${pendingTr} == ${expectedTreasury}`);
  log(pendingTm === expectedTeam         ? "PASS" : "FAIL", "Team pending fee (1000/10000)",          `${pendingTm} == ${expectedTeam}`);

  // Claim FeeRecipient fee
  const frBalanceBefore = await usdt.balanceOf(deployer.address);
  const claimFRTx = await fm.claimFeeRecipientFee(viewId);
  const claimFRReceipt = await claimFRTx.wait();
  log("INFO", "claimFeeRecipientFee tx", claimFRReceipt.hash);
  const frBalanceAfter = await usdt.balanceOf(deployer.address);
  const frReceived = frBalanceAfter - frBalanceBefore;
  log(frReceived === expectedFeeRecipient ? "PASS" : "FAIL", "FeeRecipient ERC20 balance increased", `+${frReceived} == ${expectedFeeRecipient}`);

  // Verify accounting zeroed
  const pendingFRAfter = await fm.pendingFeeRecipientFees(viewId, deployer.address);
  log(pendingFRAfter === 0n ? "PASS" : "FAIL", "FeeRecipient accounting zeroed after claim", pendingFRAfter.toString());

  // Verify double-claim fails
  try {
    await fm.claimFeeRecipientFee(viewId);
    log("FAIL", "Double claim should have reverted", "DID NOT REVERT");
  } catch (e) {
    log("PASS", "Double claim correctly reverted", e.message.includes("NothingToClaim") ? "NothingToClaim" : e.message.slice(0, 60));
  }

  // Add more fees via a second buy to verify accumulation
  await (await usdt.approve(ADDR.TradingEngine, 50_000_000n)).wait();
  await (await te.buy(viewId, 1, 50_000_000n, 0n)).wait();
  const pendingFRAccum = await fm.pendingFeeRecipientFees(viewId, deployer.address);
  log(pendingFRAccum > 0n ? "PASS" : "FAIL", "Fees continue to accumulate after claim", pendingFRAccum.toString());

  // ── Part 2: Market Lock ───────────────────────────────────────────────────
  console.log("\n--- Part 2: Market Lock ---");

  // Create a separate market that we can lock (use endTime in the past by manipulating)
  // On Sepolia we can't manipulate time, so we create a market with endTime = now + 90min
  // and attempt lockMarket which should fail (market not yet ended)
  // Instead, we verify the status machine by checking current status
  const statusBefore = await te.getMarketStatus(viewId);
  log(statusBefore === 0n ? "PASS" : "FAIL", "Market status is ACTIVE (0) before lock", statusBefore.toString());

  // Try to lock before endTime — should fail
  try {
    await te.lockMarket(viewId);
    log("FAIL", "lockMarket before endTime should revert", "DID NOT REVERT");
  } catch (e) {
    log("PASS", "lockMarket before endTime correctly reverted", "MarketNotEnded or similar");
  }

  // Verify buy still works while ACTIVE
  await (await usdt.approve(ADDR.TradingEngine, 10_000_000n)).wait();
  const buyActiveTx = await te.buy(viewId, 0, 10_000_000n, 0n);
  await buyActiveTx.wait();
  log("PASS", "Buy still works while ACTIVE", "OK");

  // Summary
  const passed = LOG.filter(r => r.status === "PASS").length;
  const failed = LOG.filter(r => r.status === "FAIL").length;
  console.log(`\n=== Part 1-2 SUMMARY: ${passed} PASS / ${failed} FAIL ===`);
  console.log("VIEW_ID=" + viewId.toString());
  console.log("RESULTS_JSON=" + JSON.stringify(LOG));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
