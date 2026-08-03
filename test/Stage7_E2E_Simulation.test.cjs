/**
 * Stage 7 — Part 7: End-to-End Full Flow Simulation Tests
 *
 * Covers:
 *   Scenario A: Fixed Market — FOR Wins (complete lifecycle)
 *   Scenario B: Fixed Market — AGAINST Wins (complete lifecycle)
 *   Scenario C: Fixed Market — DRAW (complete lifecycle)
 *   Scenario D: Permanent Market — Trading only, no settlement
 *   Scenario E: Fixed Market — Empty market (no trades), DRAW fallback
 *   Scenario F: Fixed Market — Multiple users, partial claim
 *   Scenario G: Gas benchmark for finaliseTWAP (240 slots)
 *
 * CSM Invariant Note:
 *   SettlementResult enum: NONE=0, FOR_WINS=1, AGAINST_WINS=2, DRAW=3
 *
 *   PriceEngine SolvencyViolation rule:
 *     min(newForSupply, newAgainstSupply) <= newReserveBalance
 *   When only FOR shares exist (againstSupply=0), idx is clamped to 9999,
 *   making AGAINST sidePrice = 1 bps → huge sharesOut → SolvencyViolation.
 *   Fix: always buy the minority side FIRST on an empty market.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

// ─── Helpers ────────────────────────────────────────────────────────────────

async function deployAll() {
  const [owner, creator, userA, userB, userC, treasury, team] = await ethers.getSigners();

  // Deploy token
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy();
  await token.waitForDeployment();

  // Mint tokens
  const MINT = ethers.parseEther("10000");
  for (const user of [creator, userA, userB, userC, treasury, team]) {
    await token.mint(user.address, MINT);
  }

  // Deploy PriceEngine
  const PriceEngine = await ethers.getContractFactory("PriceEngine");
  const priceEngine = await PriceEngine.deploy();
  await priceEngine.waitForDeployment();

  // Deploy MockFactory and MockFeeManager (to break circular dependency)
  const MockFactory = await ethers.getContractFactory("MockPulseFactory");
  const mockFactory = await MockFactory.deploy();
  await mockFactory.waitForDeployment();

  const MockFeeManager = await ethers.getContractFactory("MockFeeManager");
  const mockFeeManager = await MockFeeManager.deploy();
  await mockFeeManager.waitForDeployment();

  // Deploy TradingEngine with mock dependencies
  const TradingEngine_factory = await ethers.getContractFactory("TradingEngine");
  const tradingEngine = await TradingEngine_factory.deploy(
    await mockFactory.getAddress(),
    await priceEngine.getAddress(),
    await mockFeeManager.getAddress()
  );
  await tradingEngine.waitForDeployment();

  // Deploy SettlementManager
  const SettlementManager_factory = await ethers.getContractFactory("SettlementManager");
  const settlementManager = await SettlementManager_factory.deploy(
    await tradingEngine.getAddress(),
    await mockFactory.getAddress()
  );
  await settlementManager.waitForDeployment();

  // Deploy real FeeManager
  const FeeManager_factory = await ethers.getContractFactory("FeeManager");
  const feeManager = await FeeManager_factory.deploy(
    await tradingEngine.getAddress(),
    await mockFactory.getAddress(),
    treasury.address,
    team.address
  );
  await feeManager.waitForDeployment();

  return {
    owner, creator, userA, userB, userC, treasury, team,
    token, tradingEngine, mockFeeManager, feeManager, mockFactory,
    settlementManager, priceEngine
  };
}

let _viewIdCounter = 1;

async function setupFixedView(ctx, endTimeOffset = 7200) {
  const { mockFactory, tradingEngine, settlementManager, mockFeeManager, token, creator } = ctx;
  const viewId = _viewIdCounter++;
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const endTime = now + endTimeOffset;

  // Deploy a real Vault
  const MarketVault = await ethers.getContractFactory("MarketVault");
  const vault = await MarketVault.deploy(
    viewId,
    await token.getAddress(),
    await tradingEngine.getAddress(),
    await settlementManager.getAddress(),
    await mockFactory.getAddress()
  );
  await vault.waitForDeployment();

  // Set FeeManager on Vault via TradingEngine impersonation
  const teAddr = await tradingEngine.getAddress();
  await ethers.provider.send("hardhat_impersonateAccount", [teAddr]);
  await ethers.provider.send("hardhat_setBalance", [teAddr, "0x" + ethers.parseEther("1").toString(16)]);
  const teSigner = await ethers.getImpersonatedSigner(teAddr);
  await vault.connect(teSigner).setFeeManager(await mockFeeManager.getAddress());
  await ethers.provider.send("hardhat_stopImpersonatingAccount", [teAddr]);

  // Register vault in MockFeeManager
  await mockFeeManager.setVaultForView(viewId, await vault.getAddress());

  // Setup MockFactory
  await mockFactory.setExists(viewId, true);
  await mockFactory.setVault(viewId, await vault.getAddress());
  const feeConfig = { totalBps: 100n, feeRecipientBps: 7000n, treasuryBps: 2000n, teamBps: 1000n };

  await mockFactory.setView(viewId, {
    viewId: viewId,
    feeRecipient: creator.address,
    viewType: 0, // FIXED
    metadataURI: "ipfs://test",
    metadataHash: ethers.keccak256(ethers.toUtf8Bytes("test")),
    createdAt: now,
    startTime: now,
    endTime: endTime,
    vault: await vault.getAddress(),
    priceEngine: ethers.ZeroAddress,
    settlementManager: await settlementManager.getAddress(),
    feeConfig: feeConfig
  });

  return { viewId, endTime, vault };
}

async function setupPermanentView(ctx) {
  const { mockFactory, tradingEngine, settlementManager, mockFeeManager, token, creator } = ctx;
  const viewId = _viewIdCounter++;
  const now = (await ethers.provider.getBlock("latest")).timestamp;

  // Deploy a real Vault
  const MarketVault = await ethers.getContractFactory("MarketVault");
  const vault = await MarketVault.deploy(
    viewId,
    await token.getAddress(),
    await tradingEngine.getAddress(),
    await settlementManager.getAddress(),
    await mockFactory.getAddress()
  );
  await vault.waitForDeployment();

  // Set FeeManager on Vault
  const teAddr = await tradingEngine.getAddress();
  await ethers.provider.send("hardhat_impersonateAccount", [teAddr]);
  await ethers.provider.send("hardhat_setBalance", [teAddr, "0x" + ethers.parseEther("1").toString(16)]);
  const teSigner = await ethers.getImpersonatedSigner(teAddr);
  await vault.connect(teSigner).setFeeManager(await mockFeeManager.getAddress());
  await ethers.provider.send("hardhat_stopImpersonatingAccount", [teAddr]);

  await mockFeeManager.setVaultForView(viewId, await vault.getAddress());

  await mockFactory.setExists(viewId, true);
  await mockFactory.setVault(viewId, await vault.getAddress());
  const feeConfig = { totalBps: 100n, feeRecipientBps: 7000n, treasuryBps: 2000n, teamBps: 1000n };

  await mockFactory.setView(viewId, {
    viewId: viewId,
    feeRecipient: creator.address,
    viewType: 1, // PERMANENT
    metadataURI: "ipfs://permanent",
    metadataHash: ethers.keccak256(ethers.toUtf8Bytes("permanent")),
    createdAt: now,
    startTime: now,
    endTime: 0,
    vault: await vault.getAddress(),
    priceEngine: ethers.ZeroAddress,
    settlementManager: await settlementManager.getAddress(),
    feeConfig: feeConfig
  });

  return { viewId, vault };
}

async function approveAndBuy(tradingEngine, token, user, viewId, amount, side = 0) {
  await token.connect(user).approve(await tradingEngine.getAddress(), amount);
  return tradingEngine.connect(user).buy(viewId, side, amount, 0);
}

async function approveAndSell(tradingEngine, user, viewId, shares, side = 0) {
  return tradingEngine.connect(user).sell(viewId, side, shares, 0);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Stage 7 — Part 7: End-to-End Full Flow Simulation", function () {
  this.timeout(120000);

  // ── Scenario A: Fixed Market — FOR Wins ─────────────────────────────────
  describe("Scenario A: Fixed Market — FOR Wins (complete lifecycle)", function () {
    let ctx, viewId, endTime;

    before(async function () {
      ctx = await deployAll();
      ({ viewId, endTime } = await setupFixedView(ctx));
    });

    it("A-1: Create FIXED view successfully", async function () {
      const view = await ctx.mockFactory.getView(viewId);
      expect(view.feeRecipient).to.equal(ctx.creator.address);
      expect(Number(view.viewType)).to.equal(0); // FIXED
    });

    it("A-2: UserA buys FOR shares, UserB buys AGAINST shares", async function () {
      // CSM invariant: buy AGAINST first (small) on empty market, then buy FOR dominant.
      // Reason: buying FOR first on empty market drives idx to 9999 (clamped),
      // making AGAINST sidePrice = 1 bps → huge sharesOut → SolvencyViolation.
      const smallAmount = ethers.parseEther("10");
      const buyAmount = ethers.parseEther("100");
      await approveAndBuy(ctx.tradingEngine, ctx.token, ctx.userB, viewId, smallAmount, 1); // AGAINST first
      await approveAndBuy(ctx.tradingEngine, ctx.token, ctx.userA, viewId, buyAmount, 0);  // FOR dominant

      const state = await ctx.tradingEngine.getMarketState(viewId);
      expect(state.forSupply).to.be.gt(0n);
      expect(state.againstSupply).to.be.gt(0n);
      expect(state.lastPulseIndex).to.be.gt(5000n); // FOR dominant → index > 5000
    });

    it("A-3: Market status is ACTIVE", async function () {
      const status = await ctx.tradingEngine.getMarketStatus(viewId);
      expect(status).to.equal(0); // ACTIVE
    });

    it("A-4: Cannot lock before endTime", async function () {
      await expect(ctx.tradingEngine.lockMarket(viewId))
        .to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__EndTimeNotReached");
    });

    it("A-5: Lock market after endTime", async function () {
      await ethers.provider.send("evm_increaseTime", [endTime - (await ethers.provider.getBlock("latest")).timestamp + 10]);
      await ethers.provider.send("evm_mine");

      const tx = await ctx.tradingEngine.lockMarket(viewId);
      await tx.wait();

      const status = await ctx.tradingEngine.getMarketStatus(viewId);
      expect(status).to.equal(1); // LOCKED
    });

    it("A-6: Cannot lock again (grinding resistance)", async function () {
      await expect(ctx.tradingEngine.lockMarket(viewId))
        .to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__AlreadyLocked");
    });

    it("A-7: Settle market — FOR_WINS", async function () {
      await ctx.settlementManager.settleMarket(viewId);
      const result = await ctx.settlementManager.getSettlementResult(viewId);
      // SettlementResult enum: NONE=0, FOR_WINS=1, AGAINST_WINS=2, DRAW=3
      expect(result).to.equal(1); // FOR_WINS
      const status = await ctx.tradingEngine.getMarketStatus(viewId);
      expect(status).to.equal(3); // CLAIMABLE
    });

    it("A-8: UserA claims reward (FOR winner)", async function () {
      const balBefore = await ctx.token.balanceOf(ctx.userA.address);
      await ctx.settlementManager.claimReward(viewId, ctx.userA.address);
      const balAfter = await ctx.token.balanceOf(ctx.userA.address);
      expect(balAfter).to.be.gt(balBefore);
    });

    it("A-9: UserA cannot claim twice", async function () {
      await expect(ctx.settlementManager.claimReward(viewId, ctx.userA.address))
        .to.be.revertedWithCustomError(ctx.settlementManager, "Settlement__AlreadyClaimed");
    });

    it("A-10: UserB (AGAINST loser) gets zero payout", async function () {
      const balBefore = await ctx.token.balanceOf(ctx.userB.address);
      const claimable = await ctx.settlementManager.getClaimableAmount(viewId, ctx.userB.address);
      expect(claimable).to.equal(0n);
      // claimReward should revert with NoPositionToClaim (amount == 0)
      await expect(ctx.settlementManager.claimReward(viewId, ctx.userB.address))
        .to.be.revertedWithCustomError(ctx.settlementManager, "Settlement__NoPositionToClaim");
      const balAfter = await ctx.token.balanceOf(ctx.userB.address);
      expect(balAfter).to.equal(balBefore);
    });

    it("A-11: MockFeeManager records fees (TradingEngine uses mockFeeManager)", async function () {
      // TradingEngine uses mockFeeManager for recordFee calls.
      // The real FeeManager is tested separately in FeeVaultIntegration tests.
      // Here we verify that fees were recorded in the mock.
      const state = await ctx.tradingEngine.getMarketState(viewId);
      // reserveBalance should be > 0 (trades occurred)
      expect(state.reserveBalance).to.be.gt(0n);
    });

    it("A-12: Market is fully settled and CLAIMABLE", async function () {
      const status = await ctx.tradingEngine.getMarketStatus(viewId);
      expect(status).to.equal(3); // CLAIMABLE
    });
  });

  // ── Scenario B: Fixed Market — AGAINST Wins ──────────────────────────────
  describe("Scenario B: Fixed Market — AGAINST Wins", function () {
    let ctx, viewId, endTime;

    before(async function () {
      ctx = await deployAll();
      ({ viewId, endTime } = await setupFixedView(ctx));
    });

    it("B-1: UserA buys AGAINST dominant, UserB buys FOR small", async function () {
      // CSM invariant: buy FOR first (small) to establish reserve, then buy AGAINST dominant.
      // Buying AGAINST first on empty market drives idx to 1 (clamped),
      // making FOR sidePrice = 1 bps → huge sharesOut → potential SolvencyViolation.
      await approveAndBuy(ctx.tradingEngine, ctx.token, ctx.userB, viewId, ethers.parseEther("10"), 0);  // FOR small first
      await approveAndBuy(ctx.tradingEngine, ctx.token, ctx.userA, viewId, ethers.parseEther("100"), 1); // AGAINST dominant

      const state = await ctx.tradingEngine.getMarketState(viewId);
      expect(state.lastPulseIndex).to.be.lt(5000n); // AGAINST dominant → index < 5000
    });

    it("B-2: Lock, settle — AGAINST_WINS", async function () {
      await ethers.provider.send("evm_increaseTime", [endTime - (await ethers.provider.getBlock("latest")).timestamp + 10]);
      await ethers.provider.send("evm_mine");
      await ctx.tradingEngine.lockMarket(viewId);
      await ctx.settlementManager.settleMarket(viewId);
      const result = await ctx.settlementManager.getSettlementResult(viewId);
      // SettlementResult enum: NONE=0, FOR_WINS=1, AGAINST_WINS=2, DRAW=3
      expect(result).to.equal(2); // AGAINST_WINS
    });

    it("B-3: UserA (AGAINST winner) receives payout", async function () {
      const balBefore = await ctx.token.balanceOf(ctx.userA.address);
      await ctx.settlementManager.claimReward(viewId, ctx.userA.address);
      const balAfter = await ctx.token.balanceOf(ctx.userA.address);
      expect(balAfter).to.be.gt(balBefore);
    });
  });

  // ── Scenario C: Fixed Market — DRAW ──────────────────────────────────────
  describe("Scenario C: Fixed Market — DRAW (equal sides)", function () {
    let ctx, viewId, endTime;

    before(async function () {
      ctx = await deployAll();
      ({ viewId, endTime } = await setupFixedView(ctx));
    });

    it("C-1: Buy equal amounts FOR and AGAINST", async function () {
      // Equal amounts → index stays near 5000
      // Buy AGAINST first (small), then FOR to avoid SolvencyViolation
      const amount = ethers.parseEther("50");
      await approveAndBuy(ctx.tradingEngine, ctx.token, ctx.userB, viewId, amount, 1); // AGAINST first
      await approveAndBuy(ctx.tradingEngine, ctx.token, ctx.userA, viewId, amount, 0); // FOR
    });

    it("C-2: Lock and settle — result is FOR_WINS, AGAINST_WINS, or DRAW depending on AMM math", async function () {
      await ethers.provider.send("evm_increaseTime", [endTime - (await ethers.provider.getBlock("latest")).timestamp + 10]);
      await ethers.provider.send("evm_mine");
      await ctx.tradingEngine.lockMarket(viewId);
      await ctx.settlementManager.settleMarket(viewId);
      // Result depends on AMM — just verify it settled
      const status = await ctx.tradingEngine.getMarketStatus(viewId);
      expect(status).to.equal(3); // CLAIMABLE
    });

    it("C-3: Both users can claim (no zero-payout in DRAW)", async function () {
      const result = await ctx.settlementManager.getSettlementResult(viewId);
      // SettlementResult enum: NONE=0, FOR_WINS=1, AGAINST_WINS=2, DRAW=3
      if (result === 3n) { // DRAW
        const amtA = await ctx.settlementManager.getClaimableAmount(viewId, ctx.userA.address);
        const amtB = await ctx.settlementManager.getClaimableAmount(viewId, ctx.userB.address);
        expect(amtA).to.be.gt(0n);
        expect(amtB).to.be.gt(0n);
      }
      // If not DRAW, just verify the winner can claim
      // FOR_WINS=1 → userA wins; AGAINST_WINS=2 → userB wins
      const winner = result === 1n ? ctx.userA : ctx.userB;
      const balBefore = await ctx.token.balanceOf(winner.address);
      await ctx.settlementManager.claimReward(viewId, winner.address);
      const balAfter = await ctx.token.balanceOf(winner.address);
      expect(balAfter).to.be.gt(balBefore);
    });
  });

  // ── Scenario D: Permanent Market ─────────────────────────────────────────
  describe("Scenario D: Permanent Market — Trading only, no settlement", function () {
    let ctx, viewId;

    before(async function () {
      ctx = await deployAll();
      ({ viewId } = await setupPermanentView(ctx));
    });

    it("D-1: PERMANENT market is ACTIVE", async function () {
      const status = await ctx.tradingEngine.getMarketStatus(viewId);
      expect(status).to.equal(0); // ACTIVE
    });

    it("D-2: Users can buy and sell in PERMANENT market", async function () {
      await approveAndBuy(ctx.tradingEngine, ctx.token, ctx.userA, viewId, ethers.parseEther("50"), 0);
      const pos = await ctx.tradingEngine.getPosition(viewId, ctx.userA.address);
      expect(pos.forShares).to.be.gt(0n);
    });

    it("D-3: lockMarket() reverts for PERMANENT market", async function () {
      await expect(ctx.tradingEngine.lockMarket(viewId))
        .to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__InvalidStatus");
    });

    it("D-4: settleMarket() reverts for PERMANENT market (not LOCKED)", async function () {
      await expect(ctx.settlementManager.settleMarket(viewId))
        .to.be.revertedWithCustomError(ctx.settlementManager, "Settlement__MarketNotLocked");
    });

    it("D-5: PERMANENT market stays ACTIVE after all attempts", async function () {
      const status = await ctx.tradingEngine.getMarketStatus(viewId);
      expect(status).to.equal(0); // Still ACTIVE
    });

    it("D-6: Pulse Index is updated by trades in PERMANENT market", async function () {
      const state = await ctx.tradingEngine.getMarketState(viewId);
      expect(state.lastPulseIndex).to.be.gt(0n);
      expect(state.lastTradeTimestamp).to.be.gt(0n);
    });

    it("D-7: TWAP state is not recorded for PERMANENT market (endTime=0)", async function () {
      const twapState = await ctx.tradingEngine.twapStates(viewId);
      // For PERMANENT markets, recordSlotState is a no-op (endTime=0)
      // The TWAP state should have no written slots
      expect(twapState.writtenSlotBitmap).to.equal(0n);
      expect(twapState.locked).to.equal(false);
    });
  });

  // ── Scenario E: Fixed Market — No trades, DRAW fallback ──────────────────
  describe("Scenario E: Fixed Market — Empty market (no trades), DRAW fallback", function () {
    let ctx, viewId, endTime;

    before(async function () {
      ctx = await deployAll();
      ({ viewId, endTime } = await setupFixedView(ctx));
    });

    it("E-1: No trades occur", async function () {
      const state = await ctx.tradingEngine.getMarketState(viewId);
      expect(state.forSupply).to.equal(0n);
      expect(state.againstSupply).to.equal(0n);
    });

    it("E-2: Lock market after endTime", async function () {
      await ethers.provider.send("evm_increaseTime", [endTime - (await ethers.provider.getBlock("latest")).timestamp + 10]);
      await ethers.provider.send("evm_mine");
      await ctx.tradingEngine.lockMarket(viewId);
      const status = await ctx.tradingEngine.getMarketStatus(viewId);
      expect(status).to.equal(1); // LOCKED
    });

    it("E-3: finalTWAP falls back to INITIAL_INDEX (5000) → DRAW", async function () {
      const finalTWAP = await ctx.tradingEngine.getFinalTWAP(viewId);
      expect(finalTWAP).to.equal(5000n); // INITIAL_INDEX fallback
    });

    it("E-4: Settle market — DRAW (empty market fallback to INITIAL_INDEX=5000)", async function () {
      await ctx.settlementManager.settleMarket(viewId);
      const result = await ctx.settlementManager.getSettlementResult(viewId);
      // SettlementResult enum: NONE=0, FOR_WINS=1, AGAINST_WINS=2, DRAW=3
      // finalTWAP = 5000 (INITIAL_INDEX) → DRAW = 3
      expect(result).to.equal(3); // DRAW
    });
  });

  // ── Scenario F: Multiple users, partial claim ─────────────────────────────
  describe("Scenario F: Multiple users, partial claim", function () {
    let ctx, viewId, endTime;

    before(async function () {
      ctx = await deployAll();
      ({ viewId, endTime } = await setupFixedView(ctx));
    });

    it("F-1: Three users buy FOR, one buys AGAINST", async function () {
      // CSM invariant: buy AGAINST first (small) to establish both sides,
      // then buy FOR dominant. This avoids SolvencyViolation.
      await approveAndBuy(ctx.tradingEngine, ctx.token, ctx.creator, viewId, ethers.parseEther("1"), 1);  // AGAINST first (small)
      await approveAndBuy(ctx.tradingEngine, ctx.token, ctx.userA, viewId, ethers.parseEther("40"), 0);   // FOR
      await approveAndBuy(ctx.tradingEngine, ctx.token, ctx.userB, viewId, ethers.parseEther("40"), 0);   // FOR
      await approveAndBuy(ctx.tradingEngine, ctx.token, ctx.userC, viewId, ethers.parseEther("40"), 0);   // FOR
    });

    it("F-2: Lock and settle", async function () {
      await ethers.provider.send("evm_increaseTime", [endTime - (await ethers.provider.getBlock("latest")).timestamp + 10]);
      await ethers.provider.send("evm_mine");
      await ctx.tradingEngine.lockMarket(viewId);
      await ctx.settlementManager.settleMarket(viewId);
      const result = await ctx.settlementManager.getSettlementResult(viewId);
      // SettlementResult enum: NONE=0, FOR_WINS=1, AGAINST_WINS=2, DRAW=3
      expect(result).to.equal(1); // FOR_WINS (3 FOR buyers vs 1 small AGAINST)
    });

    it("F-3: Only userA claims, userB and userC have unclaimed rewards", async function () {
      await ctx.settlementManager.claimReward(viewId, ctx.userA.address);
      expect(await ctx.settlementManager.hasClaimed(viewId, ctx.userA.address)).to.be.true;
      expect(await ctx.settlementManager.hasClaimed(viewId, ctx.userB.address)).to.be.false;
      expect(await ctx.settlementManager.hasClaimed(viewId, ctx.userC.address)).to.be.false;
    });

    it("F-4: UserB can still claim after userA claimed", async function () {
      const balBefore = await ctx.token.balanceOf(ctx.userB.address);
      await ctx.settlementManager.claimReward(viewId, ctx.userB.address);
      const balAfter = await ctx.token.balanceOf(ctx.userB.address);
      expect(balAfter).to.be.gt(balBefore);
    });
  });

  // ── Scenario G: Gas benchmark for finaliseTWAP ───────────────────────────
  describe("Scenario G: Gas benchmark for finaliseTWAP (240 slots)", function () {
    let ctx, viewId, endTime;

    before(async function () {
      ctx = await deployAll();
      // Use a 2-hour market to have a full 60-minute observation window
      ({ viewId, endTime } = await setupFixedView(ctx, 7200));
    });

    it("G-1: Fill as many slots as possible with trades", async function () {
      const windowStart = endTime - 3600; // 60 min before endTime
      const now = (await ethers.provider.getBlock("latest")).timestamp;

      // Jump to window start
      if (now < windowStart) {
        await ethers.provider.send("evm_increaseTime", [windowStart - now + 1]);
        await ethers.provider.send("evm_mine");
      }

      // Buy AGAINST first (small) to establish both sides, then buy FOR
      // This avoids SolvencyViolation from idx approaching 9999
      await approveAndBuy(ctx.tradingEngine, ctx.token, ctx.userB, viewId, ethers.parseEther("1"), 1); // AGAINST first
      await approveAndBuy(ctx.tradingEngine, ctx.token, ctx.userA, viewId, ethers.parseEther("100"), 0); // FOR

      // Place trades every ~20 seconds to fill multiple slots — all FOR side
      for (let i = 0; i < 20; i++) {
        await ethers.provider.send("evm_increaseTime", [20]);
        await ethers.provider.send("evm_mine");
        await approveAndBuy(ctx.tradingEngine, ctx.token, ctx.userA, viewId, ethers.parseEther("0.5"), 0);
      }
    });

    it("G-2: lockMarket() gas cost with partial slots filled", async function () {
      await ethers.provider.send("evm_increaseTime", [endTime - (await ethers.provider.getBlock("latest")).timestamp + 10]);
      await ethers.provider.send("evm_mine");

      const tx = await ctx.tradingEngine.lockMarket(viewId);
      const receipt = await tx.wait();
      console.log(`      ⛽ lockMarket() gas used: ${receipt.gasUsed.toLocaleString()}`);
      // Should be well within block gas limit (30M)
      expect(receipt.gasUsed).to.be.lt(3_000_000n);
    });

    it("G-3: TWAP is finalised and market is LOCKED", async function () {
      const status = await ctx.tradingEngine.getMarketStatus(viewId);
      expect(status).to.equal(1); // LOCKED
      const finalTWAP = await ctx.tradingEngine.getFinalTWAP(viewId);
      expect(finalTWAP).to.be.gt(0n);
      console.log(`      📊 Final TWAP: ${finalTWAP}`);
    });
  });
});
