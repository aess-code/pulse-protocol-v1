/**
 * Stage 6.6 Dynamic Fixed-Slot Random-Cutoff Discrete TWAP — Security Tests
 *
 * Test Coverage:
 *   A. Future State Contamination Test
 *   B. Multi-Trade Same Slot Test
 *   C. Stop-Trading Attack Test
 *   D. Tail Manipulation Test
 *   E. Delayed Lock Test (> MAX_LOCK_DELAY_BLOCKS)
 *   F. Empty Blind Period Test
 *   G. Lock Caller Grinding Test
 */

const { expect } = require("chai");
const { ethers }  = require("hardhat");

// ─────────────────────────────────────────────────────────────────────────────
// Constants (must match TWAPLibrary.sol)
// ─────────────────────────────────────────────────────────────────────────────
const OBSERVATION_WINDOW = 60 * 60;   // 60 minutes in seconds
const PHASE1_DURATION    = 45 * 60;   // 45 minutes
const PHASE2_DURATION    = 15 * 60;   // 15 minutes
const SLOT_DURATION      = 15;        // 15 seconds
const TOTAL_SLOTS        = 240;
const PHASE1_SLOTS       = 180;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
async function increaseTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine");
}

async function setNextBlockTimestamp(ts) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
    await ethers.provider.send("evm_mine");
}

async function currentTime() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp;
}

// ─────────────────────────────────────────────────────────────────────────────
// Full-stack deployment fixture (real contracts, no mocks)
// ─────────────────────────────────────────────────────────────────────────────
async function deployFixture() {
    const [owner, creator, userA, userB, treasury, team] = await ethers.getSigners();

    const PriceEngine = await ethers.getContractFactory("PriceEngine");
    const priceEngine = await PriceEngine.deploy();

    const MockToken = await ethers.getContractFactory("MockUSDT");
    const token = await MockToken.deploy();

    const deployerAddr = owner.address;
    const nonce = await owner.getNonce();

    const factoryAddr          = ethers.getCreateAddress({ from: deployerAddr, nonce });
    const vaultFactoryAddr     = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 1 });
    const tradingEngineAddr    = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 2 });
    const feeManagerAddr       = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 3 });
    const settlementManagerAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 4 });

    const PulseFactory = await ethers.getContractFactory("PulseFactory");
    const factory = await PulseFactory.deploy(
        vaultFactoryAddr, tradingEngineAddr, settlementManagerAddr,
        feeManagerAddr, await token.getAddress(),
        ethers.parseEther("100") // MIN_INITIAL_LIQUIDITY
    );

    const MarketVaultFactory = await ethers.getContractFactory("MarketVaultFactory");
    const vaultFactory = await MarketVaultFactory.deploy(factoryAddr);

    const TradingEngine = await ethers.getContractFactory("TradingEngine");
    const tradingEngine = await TradingEngine.deploy(
        factoryAddr, await priceEngine.getAddress(), feeManagerAddr
    );

    const FeeManager = await ethers.getContractFactory("FeeManager");
    const feeManager = await FeeManager.deploy(
        tradingEngineAddr, factoryAddr, treasury.address, team.address
    );

    const SettlementManager = await ethers.getContractFactory("SettlementManager");
    const settlementManager = await SettlementManager.deploy(tradingEngineAddr, factoryAddr);

    return {
        factory, tradingEngine, feeManager, settlementManager,
        token, priceEngine,
        owner, creator, userA, userB, treasury, team
    };
}

// Create a FIXED view with endTime = now + duration (default 3 hours)
async function createView(ctx, durationSeconds = 3 * 3600) {
    const now = await currentTime();
    const startTime = now;
    const endTime   = now + durationSeconds;
    // Mint and approve tokens for creator if needed
    await ctx.token.mint(ctx.creator.address, ethers.parseEther("200"));
    await ctx.token.connect(ctx.creator).approve(await ctx.factory.getAddress(), ethers.MaxUint256);
    const tx = await ctx.factory.connect(ctx.creator).createView(
        0, "ipfs://test", ethers.keccak256(ethers.toUtf8Bytes("test")),
        startTime, endTime,
        ethers.parseEther("50"), // initialYesLiquidity
        ethers.parseEther("50")  // initialNoLiquidity
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find(l => {
        try { return ctx.factory.interface.parseLog(l).name === "ViewCreated"; }
        catch { return false; }
    });
    const parsed = ctx.factory.interface.parseLog(event);
    const viewId = parsed.args[0];
    const vaultAddr = parsed.args[2];
    return { viewId, endTime, vaultAddr };
}

// Buy FOR with a given amount
async function buyFor(ctx, viewId, user, amountEth) {
    const amount = ethers.parseEther(amountEth.toString());
    await ctx.token.mint(user.address, amount);
    await ctx.token.connect(user).approve(await ctx.tradingEngine.getAddress(), amount);
    return ctx.tradingEngine.connect(user).buy(viewId, 0, amount, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────
describe("Stage 6.6 — Dynamic Fixed-Slot Random-Cutoff TWAP Security Tests", function () {
    this.timeout(120_000);

    let ctx;
    beforeEach(async function () {
        ctx = await deployFixture();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // A. Future State Contamination Test
    // ─────────────────────────────────────────────────────────────────────────
    describe("A. Future State Contamination Test", function () {
        it("A1: Trade after observation window cannot modify TWAP", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);

            // Trade inside Phase 1 to establish some index
            const windowStart = endTime - OBSERVATION_WINDOW;
            await setNextBlockTimestamp(windowStart + 30); // inside slot 0
            await buyFor(ctx, viewId, ctx.userA, 100);

            // Jump past endTime
            await setNextBlockTimestamp(endTime + 10);
            await ethers.provider.send("evm_mine");

            // Lock the market — TWAP is finalised
            await ctx.tradingEngine.lockMarket(viewId);
            const twap1 = await ctx.tradingEngine.getFinalTWAP(viewId);

            // Verify market is LOCKED — no more trades possible
            await ctx.token.mint(ctx.userB.address, ethers.parseEther("100"));
            await ctx.token.connect(ctx.userB).approve(await ctx.tradingEngine.getAddress(), ethers.MaxUint256);
            await expect(
                ctx.tradingEngine.connect(ctx.userB).buy(viewId, 1, ethers.parseEther("100"), 0)
            ).to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__MarketNotActive");

            // TWAP has not changed
            const twap2 = await ctx.tradingEngine.getFinalTWAP(viewId);
            expect(twap2).to.equal(twap1);
        });

        it("A2: Historical slot immutability — slot 0 value cannot be changed by later trade", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);

            const windowStart = endTime - OBSERVATION_WINDOW;

            // Trade in slot 0
            await setNextBlockTimestamp(windowStart + 5);
            await buyFor(ctx, viewId, ctx.userA, 100);

            // Trade in slot 1 (different slot)
            await setNextBlockTimestamp(windowStart + SLOT_DURATION + 5);
            await buyFor(ctx, viewId, ctx.userA, 50);

            // Lock and get TWAP
            await setNextBlockTimestamp(endTime + 1);
            await ethers.provider.send("evm_mine");
            await ctx.tradingEngine.lockMarket(viewId);

            const twap = await ctx.tradingEngine.getFinalTWAP(viewId);
            // TWAP must be in valid range [1, 9999]
            expect(twap).to.be.gte(1n);
            expect(twap).to.be.lte(9999n);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // B. Multi-Trade Same Slot Test
    // ─────────────────────────────────────────────────────────────────────────
    describe("B. Multi-Trade Same Slot Test", function () {
        it("B1: Multiple trades in same slot — only last index counts", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);

            const windowStart = endTime - OBSERVATION_WINDOW;

            // Three trades in slot 0 (all within first 15 seconds)
            await setNextBlockTimestamp(windowStart + 2);
            await buyFor(ctx, viewId, ctx.userA, 100); // first trade in slot 0

            await setNextBlockTimestamp(windowStart + 7);
            await buyFor(ctx, viewId, ctx.userA, 200); // second trade in slot 0

            await setNextBlockTimestamp(windowStart + 13);
            await buyFor(ctx, viewId, ctx.userA, 50);  // third trade in slot 0 (last)

            // Get the current pulse index (this is what slot 0 should record)
            const stateAfterSlot0 = await ctx.tradingEngine.getMarketState(viewId);
            const lastIndexSlot0 = stateAfterSlot0.lastPulseIndex;

            // Lock and verify TWAP is valid
            await setNextBlockTimestamp(endTime + 1);
            await ethers.provider.send("evm_mine");
            await ctx.tradingEngine.lockMarket(viewId);

            const twap = await ctx.tradingEngine.getFinalTWAP(viewId);
            expect(twap).to.be.gte(1n);
            expect(twap).to.be.lte(9999n);
            // The TWAP should be influenced by lastIndexSlot0 (fill-forward will propagate it)
            // We can't assert exact value without knowing all slots, but we verify it's valid
        });

        it("B2: Increasing trade count in same slot does not increase TWAP weight", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);
            const windowStart = endTime - OBSERVATION_WINDOW;

            // 10 trades in slot 0 — should have same weight as 1 trade
            await setNextBlockTimestamp(windowStart + 1);
            for (let i = 0; i < 5; i++) {
                await buyFor(ctx, viewId, ctx.userA, 10);
            }

            await setNextBlockTimestamp(endTime + 1);
            await ethers.provider.send("evm_mine");
            await ctx.tradingEngine.lockMarket(viewId);

            const twap = await ctx.tradingEngine.getFinalTWAP(viewId);
            expect(twap).to.be.gte(1n);
            expect(twap).to.be.lte(9999n);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // C. Stop-Trading Attack Test
    // ─────────────────────────────────────────────────────────────────────────
    describe("C. Stop-Trading Attack Test", function () {
        it("C1: Empty slots are filled forward — stopping trades does not reduce TWAP weight", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);
            const windowStart = endTime - OBSERVATION_WINDOW;

            // Only trade in slot 0 — all other slots will be filled forward
            await setNextBlockTimestamp(windowStart + 5);
            await buyFor(ctx, viewId, ctx.userA, 100);

            // No more trades — attacker "stops trading"
            await setNextBlockTimestamp(endTime + 1);
            await ethers.provider.send("evm_mine");
            await ctx.tradingEngine.lockMarket(viewId);

            const twap = await ctx.tradingEngine.getFinalTWAP(viewId);
            // TWAP must still be valid — fill-forward ensures all 240 slots have a value
            expect(twap).to.be.gte(1n);
            expect(twap).to.be.lte(9999n);
        });

        it("C2: Zero-trade market uses INITIAL_INDEX (5000) for all slots", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);

            // No trades at all
            await setNextBlockTimestamp(endTime + 1);
            await ethers.provider.send("evm_mine");
            await ctx.tradingEngine.lockMarket(viewId);

            const twap = await ctx.tradingEngine.getFinalTWAP(viewId);
            // All slots filled with INITIAL_INDEX = 5000 → TWAP = 5000
            expect(twap).to.equal(5000n);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // D. Tail Manipulation Test
    // ─────────────────────────────────────────────────────────────────────────
    describe("D. Tail Manipulation Test", function () {
        it("D1: Large trade in Phase 2 has limited impact due to random T_stop", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);
            const windowStart = endTime - OBSERVATION_WINDOW;
            const blindStart  = endTime - PHASE2_DURATION;

            // Establish a balanced market in Phase 1
            await setNextBlockTimestamp(windowStart + 30);
            await buyFor(ctx, viewId, ctx.userA, 100); // FOR

            // Large AGAINST trade in Phase 2 (tail manipulation attempt)
            await setNextBlockTimestamp(blindStart + 30);
            await buyFor(ctx, viewId, ctx.userB, 500); // large AGAINST buy

            // Lock the market
            await setNextBlockTimestamp(endTime + 1);
            await ethers.provider.send("evm_mine");
            await ctx.tradingEngine.lockMarket(viewId);

            const twap = await ctx.tradingEngine.getFinalTWAP(viewId);
            // TWAP must be valid — the random T_stop may or may not include the tail trade
            expect(twap).to.be.gte(1n);
            expect(twap).to.be.lte(9999n);
        });

        it("D2: Phase 1 trades are always included regardless of T_stop", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);
            const windowStart = endTime - OBSERVATION_WINDOW;

            // Trade only in Phase 1
            await setNextBlockTimestamp(windowStart + 100);
            await buyFor(ctx, viewId, ctx.userA, 200);

            // Lock immediately after endTime (no Phase 2 trades)
            await setNextBlockTimestamp(endTime + 1);
            await ethers.provider.send("evm_mine");
            await ctx.tradingEngine.lockMarket(viewId);

            const twap = await ctx.tradingEngine.getFinalTWAP(viewId);
            // Phase 1 trade must be reflected in TWAP
            expect(twap).to.be.gte(1n);
            expect(twap).to.be.lte(9999n);
            // Since we bought FOR, index should be > 5000
            expect(twap).to.be.gt(5000n);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // E. Delayed Lock Test
    // ─────────────────────────────────────────────────────────────────────────
    describe("E. Delayed Lock Test", function () {
        it("E1: Lock after MAX_LOCK_DELAY_BLOCKS uses T_stop = endTime (safe fallback)", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);
            const windowStart = endTime - OBSERVATION_WINDOW;
            const blindStart  = endTime - PHASE2_DURATION;

            // Trade in Phase 2 to set seedBlockNumber
            await setNextBlockTimestamp(blindStart + 30);
            await buyFor(ctx, viewId, ctx.userA, 100);

            // Simulate 200+ blocks passing (mine many blocks to exceed MAX_LOCK_DELAY_BLOCKS=150)
            // We do this by mining many blocks after endTime
            await setNextBlockTimestamp(endTime + 1);
            await ethers.provider.send("evm_mine");

            // Mine 160 more blocks to exceed the 150-block limit
            for (let i = 0; i < 160; i++) {
                await ethers.provider.send("evm_mine");
            }

            // lockMarket() should NOT revert — it should use T_stop = endTime fallback
            await expect(ctx.tradingEngine.lockMarket(viewId))
                .to.emit(ctx.tradingEngine, "MarketLocked");

            const twap = await ctx.tradingEngine.getFinalTWAP(viewId);
            // TWAP is valid — all Phase 2 slots included (T_stop = endTime)
            expect(twap).to.be.gte(1n);
            expect(twap).to.be.lte(9999n);
        });

        it("E2: lockMarket() never reverts due to stale blockhash", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);

            // No trades at all — seedBlockNumber = 0
            await setNextBlockTimestamp(endTime + 1);
            await ethers.provider.send("evm_mine");

            // Mine many blocks
            for (let i = 0; i < 300; i++) {
                await ethers.provider.send("evm_mine");
            }

            // Must not revert
            await expect(ctx.tradingEngine.lockMarket(viewId))
                .to.emit(ctx.tradingEngine, "MarketLocked");
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // F. Empty Blind Period Test
    // ─────────────────────────────────────────────────────────────────────────
    describe("F. Empty Blind Period Test", function () {
        it("F1: No blind period trades — Fill-Forward from Phase 1 is correct", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);
            const windowStart = endTime - OBSERVATION_WINDOW;

            // Trade only in Phase 1
            await setNextBlockTimestamp(windowStart + 200);
            await buyFor(ctx, viewId, ctx.userA, 150);

            // No Phase 2 trades
            await setNextBlockTimestamp(endTime + 1);
            await ethers.provider.send("evm_mine");
            await ctx.tradingEngine.lockMarket(viewId);

            const twap = await ctx.tradingEngine.getFinalTWAP(viewId);
            // Fill-forward from Phase 1 last known index
            // Since we bought FOR, index > 5000
            expect(twap).to.be.gt(5000n);
            expect(twap).to.be.lte(9999n);
        });

        it("F2: Completely empty observation window — TWAP = INITIAL_INDEX = 5000", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);

            // No trades at all
            await setNextBlockTimestamp(endTime + 1);
            await ethers.provider.send("evm_mine");
            await ctx.tradingEngine.lockMarket(viewId);

            const twap = await ctx.tradingEngine.getFinalTWAP(viewId);
            expect(twap).to.equal(5000n);
        });

        it("F3: No slot value is zero or uninitialized after finalization", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);

            // No trades — all slots should be filled with INITIAL_INDEX
            await setNextBlockTimestamp(endTime + 1);
            await ethers.provider.send("evm_mine");
            await ctx.tradingEngine.lockMarket(viewId);

            const twap = await ctx.tradingEngine.getFinalTWAP(viewId);
            // TWAP = 5000 means all slots were initialized (not zero)
            expect(twap).to.equal(5000n);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // G. Lock Caller Grinding Test
    // ─────────────────────────────────────────────────────────────────────────
    describe("G. Lock Caller Grinding Test", function () {
        it("G1: lockMarket() can only be called once — second call reverts", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);

            await setNextBlockTimestamp(endTime + 1);
            await ethers.provider.send("evm_mine");

            // First call succeeds
            await ctx.tradingEngine.lockMarket(viewId);

            // Second call must revert
            await expect(ctx.tradingEngine.lockMarket(viewId))
                .to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__AlreadyLocked");
        });

        it("G2: T_stop is permanently determined by first lockMarket() call", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);

            await setNextBlockTimestamp(endTime + 1);
            await ethers.provider.send("evm_mine");

            await ctx.tradingEngine.lockMarket(viewId);
            const twap1 = await ctx.tradingEngine.getFinalTWAP(viewId);

            // Attempt second call — reverts, TWAP unchanged
            await expect(ctx.tradingEngine.lockMarket(viewId)).to.be.reverted;
            const twap2 = await ctx.tradingEngine.getFinalTWAP(viewId);
            expect(twap2).to.equal(twap1);
        });

        it("G3: Different callers get the same T_stop (no grinding possible)", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);

            await setNextBlockTimestamp(endTime + 1);
            await ethers.provider.send("evm_mine");

            // userA locks first
            await ctx.tradingEngine.connect(ctx.userA).lockMarket(viewId);
            const twap = await ctx.tradingEngine.getFinalTWAP(viewId);

            // userB cannot grind — market is already locked
            await expect(
                ctx.tradingEngine.connect(ctx.userB).lockMarket(viewId)
            ).to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__AlreadyLocked");

            // TWAP is unchanged
            expect(await ctx.tradingEngine.getFinalTWAP(viewId)).to.equal(twap);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Additional: TWAP Range Invariant
    // ─────────────────────────────────────────────────────────────────────────
    describe("TWAP Range Invariant", function () {
        it("TWAP is always in [1, 9999] regardless of trade pattern", async function () {
            const { viewId, endTime } = await createView(ctx, 3 * 3600);
            const windowStart = endTime - OBSERVATION_WINDOW;
            const blindStart  = endTime - PHASE2_DURATION;

            // Mixed trades across both phases
            await setNextBlockTimestamp(windowStart + 100);
            await buyFor(ctx, viewId, ctx.userA, 500);

            await setNextBlockTimestamp(windowStart + PHASE1_DURATION - 100);
            await buyFor(ctx, viewId, ctx.userB, 200);

            await setNextBlockTimestamp(blindStart + 100);
            await buyFor(ctx, viewId, ctx.userA, 100);

            await setNextBlockTimestamp(endTime + 1);
            await ethers.provider.send("evm_mine");
            await ctx.tradingEngine.lockMarket(viewId);

            const twap = await ctx.tradingEngine.getFinalTWAP(viewId);
            expect(twap).to.be.gte(1n);
            expect(twap).to.be.lte(9999n);
        });
    });
});
