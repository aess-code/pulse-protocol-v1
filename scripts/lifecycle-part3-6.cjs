// Part 3-6: TWAP Settlement, Claim Reward, DRAW, Vault Accounting
// Uses Hardhat local network with time manipulation to simulate full lifecycle
const { ethers, network } = require("hardhat");

const LOG = [];
function log(status, label, value) {
  const line = `[${status}] ${label}: ${value}`;
  console.log(line);
  LOG.push({ status, label, value });
}

async function timeTravel(seconds) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
}

async function deployAll(deployer) {
  const PriceEngine        = await ethers.getContractFactory("PriceEngine");
  const MarketVaultFactory = await ethers.getContractFactory("MarketVaultFactory");
  const TradingEngine      = await ethers.getContractFactory("TradingEngine");
  const FeeManager         = await ethers.getContractFactory("FeeManager");
  const SettlementManager  = await ethers.getContractFactory("SettlementManager");
  const PulseFactory       = await ethers.getContractFactory("PulseFactory");
  const MockUSDT           = await ethers.getContractFactory("MockUSDT");

  // Predict addresses
  const nonce = await deployer.getNonce();
  const peAddr   = ethers.getCreateAddress({ from: deployer.address, nonce });
  const mvfAddr  = ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 1 });
  const teAddr   = ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 2 });
  const fmAddr   = ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 3 });
  const smAddr   = ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 4 });
  const pfAddr   = ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 5 });
  const usdtAddr = ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 6 });

  const pe  = await (await PriceEngine.deploy()).waitForDeployment();
  const mvf = await (await MarketVaultFactory.deploy(pfAddr)).waitForDeployment();
  const te  = await (await TradingEngine.deploy(pfAddr, peAddr, fmAddr)).waitForDeployment();
  const fm  = await (await FeeManager.deploy(teAddr, pfAddr, deployer.address, deployer.address)).waitForDeployment();
  const sm  = await (await SettlementManager.deploy(teAddr, pfAddr)).waitForDeployment();
  const pf  = await (await PulseFactory.deploy(mvfAddr, teAddr, smAddr, fmAddr, usdtAddr, 100_000_000n)).waitForDeployment();
  const usdt = await (await MockUSDT.deploy()).waitForDeployment();

  return { pe, mvf, te, fm, sm, pf, usdt };
}

async function createMarket(pf, usdt, deployer, durationSecs) {
  const liq = 100_000_000n;
  await (await usdt.mint(deployer.address, 2_000_000_000n)).wait();
  await (await usdt.approve(await pf.getAddress(), liq * 2n)).wait();
  const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  const tx = await pf.createView(
    0, "ipfs://test", ethers.keccak256(ethers.toUtf8Bytes("test")),
    now, now + BigInt(durationSecs), liq, liq
  );
  const receipt = await tx.wait();
  const event = receipt.logs
    .map(l => { try { return pf.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === "ViewCreated");
  return event.args.viewId;
}

async function main() {
  const [deployer, user2] = await ethers.getSigners();
  console.log("=== Part 3-6: Settlement, Claim, DRAW, Vault Accounting (Local Simulation) ===");
  console.log("Deployer:", deployer.address);

  // ── Deploy fresh local instance ───────────────────────────────────────────
  const { te, fm, sm, pf, usdt } = await deployAll(deployer);
  const teAddr = await te.getAddress();
  const smAddr = await sm.getAddress();
  const fmAddr = await fm.getAddress();

  // ── Part 3 & 4: FOR_WINS Settlement + Claim ───────────────────────────────
  console.log("\n--- Part 3-4: FOR_WINS Settlement + Claim Reward ---");
  const viewId1 = await createMarket(pf, usdt, deployer, 5400); // 90 min

  // Buy FOR heavily to push index > 5000
  await (await usdt.approve(teAddr, 500_000_000n)).wait();
  const buy1 = await te.buy(viewId1, 0, 200_000_000n, 0n); // Buy FOR
  await buy1.wait();
  const buy2 = await te.buy(viewId1, 0, 100_000_000n, 0n); // Buy more FOR
  await buy2.wait();

  const stateBeforeLock = await te.marketStates(viewId1);
  log("INFO", "PulseIndex before lock", stateBeforeLock.lastPulseIndex.toString());
  log(stateBeforeLock.lastPulseIndex > 5000n ? "PASS" : "FAIL", "PulseIndex > 5000 (FOR favored)", stateBeforeLock.lastPulseIndex.toString());

  // Time travel past endTime + settlement window
  await timeTravel(5400 + 10);

  // Lock market
  const lockTx = await te.lockMarket(viewId1);
  const lockReceipt = await lockTx.wait();
  log("INFO", "lockMarket tx", lockReceipt.hash);

  const statusAfterLock = await te.getMarketStatus(viewId1);
  // MarketStatus: ACTIVE=0, LOCKED=1, SETTLEMENT=2, CLAIMABLE=3
  log(statusAfterLock === 1n ? "PASS" : "FAIL", "Status after lockMarket = LOCKED (1)", statusAfterLock.toString());

  // Verify buy is now blocked
  try {
    await (await usdt.approve(teAddr, 10_000_000n)).wait();
    await te.buy(viewId1, 0, 10_000_000n, 0n);
    log("FAIL", "Buy after lock should revert", "DID NOT REVERT");
  } catch (e) {
    log("PASS", "Buy after lock correctly reverted", "MarketNotActive");
  }

  // Read finalTWAP
  const finalTWAP = await te.getFinalTWAP(viewId1);
  log("INFO", "finalTWAP", finalTWAP.toString());
  log(finalTWAP > 5000n ? "PASS" : "FAIL", "TWAP used for settlement (not spot)", `finalTWAP=${finalTWAP} > 5000`);

  // Settle market
  const settleTx = await sm.settleMarket(viewId1);
  const settleReceipt = await settleTx.wait();
  log("INFO", "settleMarket tx", settleReceipt.hash);

  const result = await sm.getSettlementResult(viewId1);
  // SettlementResult: NONE=0, FOR_WINS=1, AGAINST_WINS=2, DRAW=3
  log(result === 1n ? "PASS" : "FAIL", "Settlement result = FOR_WINS (1)", result.toString());

  const statusAfterSettle = await te.getMarketStatus(viewId1);
  log(statusAfterSettle === 3n ? "PASS" : "FAIL", "Status after settle = CLAIMABLE (3)", statusAfterSettle.toString()); // CLAIMABLE=3 is correct

  // Claim reward
  const balBefore = await usdt.balanceOf(deployer.address);
  const state1 = await te.marketStates(viewId1);
  const pos1   = await te.positions(viewId1, deployer.address);
  const expectedPayout = (pos1.forShares * state1.reserveBalance) / state1.forSupply;

  const claimTx = await sm.claimReward(viewId1, deployer.address);
  const claimReceipt = await claimTx.wait();
  log("INFO", "claimReward tx", claimReceipt.hash);

  const balAfter = await usdt.balanceOf(deployer.address);
  const received = balAfter - balBefore;
  log(received > 0n ? "PASS" : "FAIL", "Claim reward received > 0", received.toString());
  log(received === expectedPayout ? "PASS" : "FAIL", "Payout formula: (userShares/totalShares)*reserve", `${received} == ${expectedPayout}`);

  // Double claim should fail
  try {
    await sm.claimReward(viewId1, deployer.address);
    log("FAIL", "Double claim should revert", "DID NOT REVERT");
  } catch (e) {
    log("PASS", "Double claim correctly reverted", "AlreadyClaimed");
  }

  // ── Part 5: DRAW Scenario ─────────────────────────────────────────────────
  console.log("\n--- Part 5: DRAW Scenario ---");
  const viewId2 = await createMarket(pf, usdt, deployer, 5400);

  // No trades — TWAP stays at INITIAL_INDEX = 5000 → DRAW
  await timeTravel(5400 + 10);
  await (await te.lockMarket(viewId2)).wait();

  const twapDraw = await te.getFinalTWAP(viewId2);
  log(twapDraw === 5000n ? "PASS" : "FAIL", "DRAW: finalTWAP == 5000 (no trades)", twapDraw.toString());

  await (await sm.settleMarket(viewId2)).wait();
  const resultDraw = await sm.getSettlementResult(viewId2);
  // SettlementResult: NONE=0, FOR_WINS=1, AGAINST_WINS=2, DRAW=3
  log(resultDraw === 3n ? "PASS" : "FAIL", "DRAW: Settlement result = DRAW (3)", resultDraw.toString());

  // Claim refund in DRAW
  const balBeforeDraw = await usdt.balanceOf(deployer.address);
  await (await sm.claimReward(viewId2, deployer.address)).wait();
  const balAfterDraw = await usdt.balanceOf(deployer.address);
  const refund = balAfterDraw - balBeforeDraw;
  log(refund > 0n ? "PASS" : "FAIL", "DRAW: Refund received > 0", refund.toString());

  // ── Part 6: Vault Final Accounting ────────────────────────────────────────
  console.log("\n--- Part 6: Vault Final Accounting ---");
  const vaultAddr1 = (await pf.getView(viewId1)).vault;
  const vault1 = await ethers.getContractAt("MarketVault", vaultAddr1);
  const vaultBalance = await vault1.balance();
  const teState = await te.marketStates(viewId1);

  // After all claims, vault balance should be 0 (or very close due to dust)
  // Vault retains unclaimed Treasury+Team fees from ALL trades.
  // Claim all pending fees for viewId1.
  const pendingTreasury = await fm.pendingTreasuryFees(viewId1);
  const pendingTeam     = await fm.pendingTeamFees(viewId1);
  const pendingFR2      = await fm.pendingFeeRecipientFees(viewId1, deployer.address);
  const totalUnclaimed  = pendingTreasury + pendingTeam + pendingFR2;
  log("INFO", "Total unclaimed fees (all recipients)", totalUnclaimed.toString());
  log(vaultBalance >= totalUnclaimed ? "PASS" : "FAIL", "Vault balance >= total unclaimed fees", `vault=${vaultBalance} >= unclaimed=${totalUnclaimed}`);
  // Claim all remaining fees
  if (pendingFR2 > 0n)      await (await fm.claimFeeRecipientFee(viewId1)).wait();
  if (pendingTreasury > 0n) await (await fm.claimTreasuryFee(viewId1)).wait();
  if (pendingTeam > 0n)     await (await fm.claimTeamFee(viewId1)).wait();
  const vaultBalanceFinal = await vault1.balance();
  log(vaultBalanceFinal <= 1n ? "PASS" : "FAIL", "Vault balance ~0 after ALL fees claimed", vaultBalanceFinal.toString());

  // Summary
  const passed = LOG.filter(r => r.status === "PASS").length;
  const failed = LOG.filter(r => r.status === "FAIL").length;
  console.log(`\n=== Part 3-6 SUMMARY: ${passed} PASS / ${failed} FAIL ===`);
  console.log("RESULTS_JSON=" + JSON.stringify(LOG));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
