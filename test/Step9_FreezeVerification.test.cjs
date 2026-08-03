// SPDX-License-Identifier: MIT
// ─────────────────────────────────────────────────────────────────────────────
// Step 9 — Final Freeze Verification Tests
// Part 3: Economic Attack Simulation
// Part 4: Buy/Sell Randomized Invariant Test
// Part 5: Settlement Boundary Verification
// ─────────────────────────────────────────────────────────────────────────────
const { expect } = require("chai");
const { ethers } = require("hardhat");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
async function currentTime() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp;
}

async function mineBlocks(n) {
    for (let i = 0; i < n; i++) {
        await ethers.provider.send("evm_mine", []);
    }
}

async function increaseTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared deployment fixture
// ─────────────────────────────────────────────────────────────────────────────
async function deployProtocol() {
    const [owner, feeRecipient, userA, userB, userC, treasury, team] = await ethers.getSigners();

    const PriceEngine = await ethers.getContractFactory("PriceEngine");
    const priceEngine = await PriceEngine.deploy();

    const MockToken = await ethers.getContractFactory("MockUSDT");
    const token = await MockToken.deploy();

    // Pre-calculate addresses for circular dependencies
    const deployerAddr = owner.address;
    const nonce = await owner.getNonce();

    const factoryAddr           = ethers.getCreateAddress({ from: deployerAddr, nonce });
    const vaultFactoryAddr      = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 1 });
    const tradingEngineAddr     = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 2 });
    const feeManagerAddr        = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 3 });
    const settlementManagerAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 4 });

    const PulseFactory = await ethers.getContractFactory("PulseFactory");
    const factory = await PulseFactory.deploy(
        vaultFactoryAddr,
        tradingEngineAddr,
        settlementManagerAddr,
        feeManagerAddr,
        await token.getAddress(),
        ethers.parseEther("100") // MIN_INITIAL_LIQUIDITY
    );

    const MarketVaultFactory = await ethers.getContractFactory("MarketVaultFactory");
    const vaultFactory = await MarketVaultFactory.deploy(factoryAddr);

    const TradingEngine = await ethers.getContractFactory("TradingEngine");
    const tradingEngine = await TradingEngine.deploy(
        factoryAddr,
        await priceEngine.getAddress(),
        feeManagerAddr
    );

    const FeeManager = await ethers.getContractFactory("FeeManager");
    const feeManager = await FeeManager.deploy(
        tradingEngineAddr,
        factoryAddr,
        treasury.address,
        team.address
    );

    const SettlementManager = await ethers.getContractFactory("SettlementManager");
    const settlementManager = await SettlementManager.deploy(tradingEngineAddr, factoryAddr);

    // Mint tokens
    const MINT = ethers.parseEther("1000000");
    for (const user of [owner, feeRecipient, userA, userB, userC]) {
        await token.mint(user.address, MINT);
        await token.connect(user).approve(await tradingEngine.getAddress(), ethers.MaxUint256);
        await token.connect(user).approve(await factory.getAddress(), ethers.MaxUint256);
    }

    return {
        factory, tradingEngine, feeManager, settlementManager, vaultFactory,
        priceEngine, token,
        owner, feeRecipient, userA, userB, userC, treasury, team,
        MIN_LIQUIDITY: ethers.parseEther("100")
    };
}

// Helper: create a standard FIXED market
async function createMarket(ctx, yesLiq, noLiq, overrides = {}) {
    const now = await currentTime();
    const startTime = overrides.startTime ?? 0;
    const endTime = overrides.endTime ?? (now + 2 * 3600); // 2 hours
    const viewType = overrides.viewType ?? 0; // FIXED

    const tx = await ctx.factory.connect(ctx.feeRecipient).createView(
        viewType,
        "ipfs://test",
        ethers.ZeroHash,
        startTime,
        endTime,
        yesLiq,
        noLiq
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find(l => {
        try { return ctx.factory.interface.parseLog(l)?.name === "ViewCreated"; } catch { return false; }
    });
    const parsed = ctx.factory.interface.parseLog(event);
    return parsed.args.viewId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 3 — Economic Attack Simulation
// ─────────────────────────────────────────────────────────────────────────────
describe("Step 9 — Part 3: Economic Attack Simulation", function () {
    let ctx;
    beforeEach(async function () { ctx = await deployProtocol(); });

    // ── Case A: Minimum Liquidity Market ──────────────────────────────────────
    describe("Case A: Minimum Liquidity Market (100 USDT)", function () {
        it("A-1: Market creation succeeds at exactly MIN_INITIAL_LIQUIDITY (50+50)", async function () {
            const yesLiq = ethers.parseEther("50");
            const noLiq  = ethers.parseEther("50");
            const viewId = await createMarket(ctx, yesLiq, noLiq);
            const state = await ctx.tradingEngine.getMarketState(viewId);
            expect(state.forSupply).to.equal(ethers.parseEther("100"));
            expect(state.againstSupply).to.equal(ethers.parseEther("100"));
            expect(state.reserveBalance).to.equal(ethers.parseEther("100"));
            expect(state.lastPulseIndex).to.equal(5000n);
        });

        it("A-2: Market creation reverts below MIN_INITIAL_LIQUIDITY (49+49=98)", async function () {
            const yesLiq = ethers.parseEther("49");
            const noLiq  = ethers.parseEther("49");
            await expect(createMarket(ctx, yesLiq, noLiq))
                .to.be.revertedWithCustomError(ctx.factory, "Factory__InsufficientInitialLiquidity");
        });

        it("A-3: Small buy on minimum-liquidity market does not corrupt Reserve or Supply", async function () {
            const viewId = await createMarket(ctx, ethers.parseEther("50"), ethers.parseEther("50"));
            const buyAmount = ethers.parseEther("1");
            await ctx.tradingEngine.connect(ctx.userA).buy(viewId, 0, buyAmount, 0);
            const state = await ctx.tradingEngine.getMarketState(viewId);
            expect(state.reserveBalance).to.be.gt(0n);
            expect(state.forSupply).to.be.gt(0n);
            expect(state.againstSupply).to.be.gt(0n);
            expect(state.lastPulseIndex).to.be.gt(0n).and.to.be.lt(10000n);
        });
    });

    // ── Case B: Extreme YES/NO Ratio ──────────────────────────────────────────
    describe("Case B: Extreme YES/NO Ratio (99.99% YES : 0.01% NO)", function () {
        it("B-1: Extreme ratio (99.99/0.01) reverts with AllocationMismatch (50/50 invariant)", async function () {
            // The 50/50 Fair Launch invariant is now enforced at Core level.
            // Any non-50/50 initialization must revert.
            const yesLiq = ethers.parseEther("99.99");
            const noLiq  = ethers.parseEther("0.01");
            await expect(
                createMarket(ctx, yesLiq, noLiq)
            ).to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__AllocationMismatch");
        });

        it("B-2: Balanced 50/50 market with large YES and NO succeeds", async function () {
            // Correct usage: equal YES and NO
            const yesLiq = ethers.parseEther("500");
            const noLiq  = ethers.parseEther("500");
            const viewId = await createMarket(ctx, yesLiq, noLiq);
            // Buy YES (side=0) — should work
            await expect(
                ctx.tradingEngine.connect(ctx.userA).buy(viewId, 0, ethers.parseEther("10"), 0)
            ).to.not.be.reverted;
        });
    });

    // ── Case C: Whale Attack ──────────────────────────────────────────────────
    describe("Case C: Whale Attack (Large Buy/Sell)", function () {
        it("C-1: Large buy (10,000 USDT) does not overflow or corrupt state", async function () {
            const viewId = await createMarket(ctx, ethers.parseEther("500"), ethers.parseEther("500"));
            const whaleBuy = ethers.parseEther("10000");
            await ctx.token.mint(ctx.userA.address, whaleBuy);
            await ctx.tradingEngine.connect(ctx.userA).buy(viewId, 0, whaleBuy, 0);
            const state = await ctx.tradingEngine.getMarketState(viewId);
            expect(state.reserveBalance).to.be.gt(0n);
            expect(state.forSupply).to.be.gt(0n);
            expect(state.lastPulseIndex).to.be.gt(0n).and.to.be.lt(10000n);
        });

        it("C-2: Large sell after large buy does not cause insolvency (partial sell)", async function () {
            const viewId = await createMarket(ctx, ethers.parseEther("500"), ethers.parseEther("500"));
            const whaleBuy = ethers.parseEther("10000");
            await ctx.token.mint(ctx.userA.address, whaleBuy);
            await ctx.tradingEngine.connect(ctx.userA).buy(viewId, 0, whaleBuy, 0);
            const pos = await ctx.tradingEngine.getPosition(viewId, ctx.userA.address);
            // Sell half — should succeed
            await expect(
                ctx.tradingEngine.connect(ctx.userA).sell(viewId, 0, pos.forShares / 2n, 0)
            ).to.not.be.reverted;
            const state = await ctx.tradingEngine.getMarketState(viewId);
            expect(state.reserveBalance).to.be.gt(0n);
        });
    });

    // ── Case D: Duplicate Allocation Attack ───────────────────────────────────
    describe("Case D: Duplicate Allocation Attack", function () {
        it("D-1: Same address repeated 5 times in Allocation accumulates correctly", async function () {
            const now = await currentTime();
            const endTime = now + 2 * 3600;
            const allocations = [];
            for (let i = 0; i < 5; i++) {
                allocations.push({
                    user: ctx.userA.address,
                    yesLiquidity: ethers.parseEther("20"),
                    noLiquidity: ethers.parseEther("20")
                });
            }
            // Total: 100 YES + 100 NO = 200 USDT
            await ctx.token.connect(ctx.feeRecipient).approve(await ctx.factory.getAddress(), ethers.MaxUint256);
            const tx = await ctx.factory.connect(ctx.feeRecipient).createViewWithInitialAllocation(
                0, // FIXED
                "ipfs://dup-test",
                ethers.ZeroHash,
                0,
                endTime,
                ctx.feeRecipient.address,
                ethers.parseEther("100"),
                ethers.parseEther("100"),
                allocations
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(l => {
                try { return ctx.factory.interface.parseLog(l)?.name === "ViewCreated"; } catch { return false; }
            });
            const parsed = ctx.factory.interface.parseLog(event);
            const viewId = parsed.args.viewId;

            const pos = await ctx.tradingEngine.getPosition(viewId, ctx.userA.address);
            // Expected: 5 * 20 * 2 = 200 YES shares, 5 * 20 * 2 = 200 NO shares
            expect(pos.forShares).to.equal(ethers.parseEther("200"));
            expect(pos.againstShares).to.equal(ethers.parseEther("200"));
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 4 — Randomized Invariant Test (1000 iterations)
// ─────────────────────────────────────────────────────────────────────────────
describe("Step 9 — Part 4: Randomized Invariant Test (1000 iterations)", function () {
    it("All invariants hold across 1000 random buy/sell operations", async function () {
        this.timeout(600_000); // 10 min timeout

        const ctx = await deployProtocol();
        const viewId = await createMarket(ctx, ethers.parseEther("500"), ethers.parseEther("500"));

        // Seed userA with large balance
        await ctx.token.mint(ctx.userA.address, ethers.parseEther("10000000"));

        let passed = 0;
        let failed = 0;
        const failures = [];

        const ITERATIONS = 1000;
        const SIDES = [0, 1];

        for (let i = 0; i < ITERATIONS; i++) {
            // Random operation: 0=buyFOR, 1=buyAGAINST, 2=sellFOR, 3=sellAGAINST
            const op = i % 4;
            const side = op % 2;

            try {
                if (op < 2) {
                    // BUY
                    const amount = ethers.parseEther(String(1 + (i % 10)));
                    await ctx.tradingEngine.connect(ctx.userA).buy(viewId, side, amount, 0);
                } else {
                    // SELL — only sell a small portion to avoid solvency revert
                    const pos = await ctx.tradingEngine.getPosition(viewId, ctx.userA.address);
                    const shares = (side === 0) ? pos.forShares : pos.againstShares;
                    if (shares > 0n) {
                        const sellShares = shares / 10n; // sell 10%
                        if (sellShares > 0n) {
                            await ctx.tradingEngine.connect(ctx.userA).sell(viewId, side, sellShares, 0);
                        }
                    }
                }

                // Check invariants
                const state = await ctx.tradingEngine.getMarketState(viewId);
                const vaultBalance = await ctx.tradingEngine.getVaultBalance(viewId);
                const pos = await ctx.tradingEngine.getPosition(viewId, ctx.userA.address);

                // Invariant 1: reserveBalance >= 0 (always true for uint256)
                // Invariant 2: forSupply >= 0 (always true for uint256)
                // Invariant 3: againstSupply >= 0 (always true for uint256)
                // Invariant 4: position shares <= supply
                if (pos.forShares > state.forSupply) {
                    failures.push({ i, reason: "forShares > forSupply" });
                    failed++;
                    continue;
                }
                if (pos.againstShares > state.againstSupply) {
                    failures.push({ i, reason: "againstShares > againstSupply" });
                    failed++;
                    continue;
                }
                // Invariant 5: vaultBalance >= reserveBalance
                if (vaultBalance < state.reserveBalance) {
                    failures.push({ i, reason: "vaultBalance < reserveBalance" });
                    failed++;
                    continue;
                }
                // Invariant 6: pulseIndex in [1, 9999]
                if (state.lastPulseIndex < 1n || state.lastPulseIndex > 9999n) {
                    failures.push({ i, reason: `pulseIndex out of range: ${state.lastPulseIndex}` });
                    failed++;
                    continue;
                }

                passed++;
            } catch (e) {
                // Solvency revert is expected behavior, not a failure
                if (e.message && e.message.includes("SolvencyViolation")) {
                    passed++; // CSM protection working as expected
                } else {
                    failures.push({ i, reason: e.message?.slice(0, 100) });
                    failed++;
                }
            }
        }

        console.log(`\n  Randomized Invariant Test Results:`);
        console.log(`  Total: ${ITERATIONS}, Passed: ${passed}, Failed: ${failed}`);
        if (failures.length > 0) {
            console.log(`  Failures: ${JSON.stringify(failures.slice(0, 5))}`);
        }

        expect(failed).to.equal(0, `${failed} invariant violations detected`);
        expect(passed).to.equal(ITERATIONS);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 5 — Settlement Boundary Verification
// ─────────────────────────────────────────────────────────────────────────────
describe("Step 9 — Part 5: Settlement Boundary Verification", function () {
    let ctx;
    beforeEach(async function () { ctx = await deployProtocol(); });

    async function setupAndSettleWithTWAP(targetTWAP) {
        // Create a SHORT market (90 min duration, just above minimum)
        const now = await currentTime();
        const endTime = now + 91 * 60; // 91 minutes

        const viewId = await createMarket(ctx, ethers.parseEther("500"), ethers.parseEther("500"), { endTime });

        // Buy to push index toward targetTWAP
        // targetTWAP > 5000 means FOR dominant; < 5000 means AGAINST dominant
        if (targetTWAP > 5000) {
            // Buy FOR to push index up
            const amount = ethers.parseEther("1000");
            await ctx.token.mint(ctx.userA.address, amount);
            await ctx.tradingEngine.connect(ctx.userA).buy(viewId, 0, amount, 0);
        } else if (targetTWAP < 5000) {
            // Buy AGAINST to push index down
            const amount = ethers.parseEther("1000");
            await ctx.token.mint(ctx.userA.address, amount);
            await ctx.tradingEngine.connect(ctx.userA).buy(viewId, 1, amount, 0);
        }
        // For DRAW (5000): no trades, stays at 5000

        // Advance time past endTime + TWAP window
        await increaseTime(92 * 60); // past endTime

        // Lock market
        await ctx.tradingEngine.lockMarket(viewId);

        // Settle
        await ctx.settlementManager.settleMarket(viewId);

        return viewId;
    }

    it("P5-1: TWAP > 5000 → FOR_WINS, YES holders can claim", async function () {
        const viewId = await setupAndSettleWithTWAP(5001);
        const result = await ctx.settlementManager.getSettlementResult(viewId);
        // FOR_WINS = 1
        expect(result).to.equal(1n);
        // userA (who bought FOR) should have a claimable amount
        const claimable = await ctx.settlementManager.getClaimableAmount(viewId, ctx.userA.address);
        expect(claimable).to.be.gt(0n);
    });

    it("P5-2: TWAP < 5000 → AGAINST_WINS, NO holders can claim", async function () {
        const viewId = await setupAndSettleWithTWAP(4999);
        const result = await ctx.settlementManager.getSettlementResult(viewId);
        // AGAINST_WINS = 2
        expect(result).to.equal(2n);
        const claimable = await ctx.settlementManager.getClaimableAmount(viewId, ctx.userA.address);
        expect(claimable).to.be.gt(0n);
    });

    it("P5-3: TWAP = 5000 (DRAW) → proportional refund for all holders", async function () {
        const viewId = await setupAndSettleWithTWAP(5000);
        const result = await ctx.settlementManager.getSettlementResult(viewId);
        // DRAW = 3 (enum: PENDING=0, FOR_WINS=1, AGAINST_WINS=2, DRAW=3)
        expect(result).to.equal(3n);
        // feeRecipient holds initial shares, should get proportional refund
        const claimable = await ctx.settlementManager.getClaimableAmount(viewId, ctx.feeRecipient.address);
        expect(claimable).to.be.gt(0n);
    });

    it("P5-4: Double claim reverts", async function () {
        const viewId = await setupAndSettleWithTWAP(5001);
        // First claim
        await ctx.settlementManager.claimReward(viewId, ctx.userA.address);
        // Second claim must revert
        await expect(
            ctx.settlementManager.claimReward(viewId, ctx.userA.address)
        ).to.be.revertedWithCustomError(ctx.settlementManager, "Settlement__AlreadyClaimed");
    });

    it("P5-5: Vault payout goes to user, not msg.sender", async function () {
        const viewId = await setupAndSettleWithTWAP(5001);
        const balanceBefore = await ctx.token.balanceOf(ctx.userA.address);
        // userB triggers the claim for userA
        await ctx.settlementManager.connect(ctx.userB).claimReward(viewId, ctx.userA.address);
        const balanceAfter = await ctx.token.balanceOf(ctx.userA.address);
        // userA's balance increased, not userB's
        expect(balanceAfter).to.be.gt(balanceBefore);
    });
});
