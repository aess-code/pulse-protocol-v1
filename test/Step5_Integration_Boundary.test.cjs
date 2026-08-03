"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// Step 5 — Core Integration Boundary Tests
// Factory + FeeManager + TradingEngine full-stack integration
// ─────────────────────────────────────────────────────────────────────────────
const { expect } = require("chai");
const { ethers } = require("hardhat");

async function currentTime() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp;
}

// ─────────────────────────────────────────────────────────────────────────
// Shared deployment fixture
// ─────────────────────────────────────────────────────────────────────────────
async function deployProtocol() {
    const [owner, feeRecipient, userA, userB, treasury, team] = await ethers.getSigners();

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
        ethers.parseEther("100") // MIN_INITIAL_LIQUIDITY = 100 USDT
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

    // Mint tokens for all actors
    for (const user of [owner, feeRecipient, userA, userB]) {
        await token.mint(user.address, ethers.parseEther("10000"));
    }

    return {
        factory, tradingEngine, feeManager, settlementManager, vaultFactory,
        token, priceEngine,
        owner, feeRecipient, userA, userB, treasury, team
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────
describe("Step 5 — Core Integration Boundary Tests", function () {
    let ctx;

    beforeEach(async function () {
        ctx = await deployProtocol();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Section 1: FeeManager Integration — 7000/2000/1000 BPS Verification
    // ─────────────────────────────────────────────────────────────────────────
    describe("Section 1: FeeManager Integration — Fee Split 70/20/10", function () {

        it("feeConfig() returns 7000/2000/1000/100", async function () {
            const [feeRecipientBps, treasuryBps, teamBps, totalBps] = await ctx.feeManager.feeConfig();
            expect(feeRecipientBps).to.equal(7000n);
            expect(treasuryBps).to.equal(2000n);
            expect(teamBps).to.equal(1000n);
            expect(totalBps).to.equal(100n);
        });

        it("100 USDT buy: 1 USDT total fee splits 0.70/0.20/0.10 correctly", async function () {
            // Create market
            await ctx.token.connect(ctx.feeRecipient).approve(await ctx.factory.getAddress(), ethers.MaxUint256);
            await ctx.factory.connect(ctx.feeRecipient).createView(
                0, "ipfs://test", ethers.ZeroHash,
                0, (await currentTime()) + 86400 * 7,
                ethers.parseEther("500"), ethers.parseEther("500")
            );
            const viewId = 1;

            // userA buys 100 USDT
            const amountIn = ethers.parseEther("100");
            await ctx.token.connect(ctx.userA).approve(await ctx.tradingEngine.getAddress(), ethers.MaxUint256);
            await ctx.tradingEngine.connect(ctx.userA).buy(viewId, 0, amountIn, 0);

            // Total fee = 1% of 100 = 1 USDT
            const totalFee = amountIn / 100n;

            // FeeRecipient gets 70%
            const expectedFeeRecipient = (totalFee * 7000n) / 10000n;
            // Treasury gets 20%
            const expectedTreasury = (totalFee * 2000n) / 10000n;
            // Team gets remainder (absorbs dust)
            const expectedTeam = totalFee - expectedFeeRecipient - expectedTreasury;

            const pendingFR = await ctx.feeManager.pendingFeeRecipientFees(viewId, ctx.feeRecipient.address);
            const pendingTreasury = await ctx.feeManager.pendingTreasuryFees(viewId);
            const pendingTeam = await ctx.feeManager.pendingTeamFees(viewId);

            expect(pendingFR).to.equal(expectedFeeRecipient);
            expect(pendingTreasury).to.equal(expectedTreasury);
            expect(pendingTeam).to.equal(expectedTeam);
            expect(pendingFR + pendingTreasury + pendingTeam).to.equal(totalFee);
        });

        it("recordFee uses feeRecipient from ViewRecord, not msg.sender", async function () {
            // Create market with a specific feeRecipient (not the caller)
            const allocs = [
                { user: ctx.feeRecipient.address, yesLiquidity: ethers.parseEther("500"), noLiquidity: ethers.parseEther("500") }
            ];
            await ctx.token.connect(ctx.owner).approve(await ctx.factory.getAddress(), ethers.MaxUint256);
            await ctx.factory.connect(ctx.owner).createViewWithInitialAllocation(
                0, "ipfs://test", ethers.ZeroHash,
                0, (await currentTime()) + 86400 * 7,
                ctx.feeRecipient.address, // feeRecipient is NOT the caller (owner)
                ethers.parseEther("500"),
                ethers.parseEther("500"),
                allocs
            );
            const viewId = 1;

            // userA buys
            await ctx.token.connect(ctx.userA).approve(await ctx.tradingEngine.getAddress(), ethers.MaxUint256);
            await ctx.tradingEngine.connect(ctx.userA).buy(viewId, 0, ethers.parseEther("100"), 0);

            // Fee must be credited to feeRecipient, not to owner
            const pendingFR = await ctx.feeManager.pendingFeeRecipientFees(viewId, ctx.feeRecipient.address);
            const pendingOwner = await ctx.feeManager.pendingFeeRecipientFees(viewId, ctx.owner.address);
            expect(pendingFR).to.be.gt(0n);
            expect(pendingOwner).to.equal(0n);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Section 2: Factory Dual Entry Tests
    // ─────────────────────────────────────────────────────────────────────────
    describe("Section 2: Factory Dual Entry", function () {

        it("createView() auto-binds feeRecipient = msg.sender", async function () {
            await ctx.token.connect(ctx.userA).approve(await ctx.factory.getAddress(), ethers.MaxUint256);
            await ctx.factory.connect(ctx.userA).createView(
                0, "ipfs://test", ethers.ZeroHash,
                0, (await currentTime()) + 86400,
                ethers.parseEther("50"), ethers.parseEther("50")
            );
            const view = await ctx.factory.getView(1);
            expect(view.feeRecipient).to.equal(ctx.userA.address);
        });

        it("createView() creates single Allocation for msg.sender", async function () {
            await ctx.token.connect(ctx.userA).approve(await ctx.factory.getAddress(), ethers.MaxUint256);
            await ctx.factory.connect(ctx.userA).createView(
                0, "ipfs://test", ethers.ZeroHash,
                0, (await currentTime()) + 86400,
                ethers.parseEther("50"), ethers.parseEther("50")
            );
            const pos = await ctx.tradingEngine.getPosition(1, ctx.userA.address);
            expect(pos.forShares).to.equal(ethers.parseEther("100")); // 50 * 2
            expect(pos.againstShares).to.equal(ethers.parseEther("100")); // 50 * 2
        });

        it("createViewWithInitialAllocation() supports multiple allocations", async function () {
            const allocs = [
                { user: ctx.userA.address, yesLiquidity: ethers.parseEther("100"), noLiquidity: ethers.parseEther("100") },
                { user: ctx.userB.address, yesLiquidity: ethers.parseEther("150"), noLiquidity: ethers.parseEther("150") }
            ];
            await ctx.token.connect(ctx.owner).approve(await ctx.factory.getAddress(), ethers.MaxUint256);
            await ctx.factory.connect(ctx.owner).createViewWithInitialAllocation(
                0, "ipfs://test", ethers.ZeroHash,
                0, (await currentTime()) + 86400,
                ctx.feeRecipient.address,
                ethers.parseEther("250"),
                ethers.parseEther("250"),
                allocs
            );
            const posA = await ctx.tradingEngine.getPosition(1, ctx.userA.address);
            const posB = await ctx.tradingEngine.getPosition(1, ctx.userB.address);
            expect(posA.forShares).to.equal(ethers.parseEther("200")); // 100 * 2
            expect(posB.forShares).to.equal(ethers.parseEther("300")); // 150 * 2
        });

        it("createViewWithInitialAllocation() supports duplicate addresses (+=) with 50/50", async function () {
            // 50/50 invariant: each alloc must result in equal YES and NO totals
            const allocs = [
                { user: ctx.userA.address, yesLiquidity: ethers.parseEther("100"), noLiquidity: ethers.parseEther("100") },
                { user: ctx.userA.address, yesLiquidity: ethers.parseEther("100"), noLiquidity: ethers.parseEther("100") }
            ];
            await ctx.token.connect(ctx.owner).approve(await ctx.factory.getAddress(), ethers.MaxUint256);
            const tx = await ctx.factory.connect(ctx.owner).createViewWithInitialAllocation(
                0, "ipfs://test", ethers.ZeroHash,
                0, (await currentTime()) + 86400,
                ctx.feeRecipient.address,
                ethers.parseEther("200"),
                ethers.parseEther("200"),
                allocs
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(l => {
                try { return ctx.factory.interface.parseLog(l)?.name === "ViewCreated"; } catch { return false; }
            });
            const viewId = ctx.factory.interface.parseLog(event).args.viewId;
            const pos = await ctx.tradingEngine.getPosition(viewId, ctx.userA.address);
            expect(pos.forShares).to.equal(ethers.parseEther("400")); // (100+100) * 2
            expect(pos.againstShares).to.equal(ethers.parseEther("400")); // (100+100) * 2
        });

        it("createViewWithInitialAllocation() enforces fund conservation", async function () {
            // Sum mismatch should revert
            const allocs = [
                { user: ctx.userA.address, yesLiquidity: ethers.parseEther("100"), noLiquidity: ethers.parseEther("100") }
            ];
            await ctx.token.connect(ctx.owner).approve(await ctx.factory.getAddress(), ethers.MaxUint256);
            await expect(
                ctx.factory.connect(ctx.owner).createViewWithInitialAllocation(
                    0, "ipfs://test", ethers.ZeroHash,
                    0, (await currentTime()) + 86400,
                    ctx.feeRecipient.address,
                    ethers.parseEther("200"), // declared total != actual sum
                    ethers.parseEther("100"),
                    allocs
                )
            ).to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__AllocationMismatch");
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Section 3: Initial Liquidity Integration
    // ─────────────────────────────────────────────────────────────────────────
    describe("Section 3: Initial Liquidity Integration", function () {

        it("YES=500 NO=500 → forSupply=1000 againstSupply=1000 PulseIndex=5000 ACTIVE", async function () {
            await ctx.token.connect(ctx.feeRecipient).approve(await ctx.factory.getAddress(), ethers.MaxUint256);
            await ctx.factory.connect(ctx.feeRecipient).createView(
                0, "ipfs://test", ethers.ZeroHash,
                0, (await currentTime()) + 86400,
                ethers.parseEther("500"),
                ethers.parseEther("500")
            );
            const state = await ctx.tradingEngine.getMarketState(1);
            expect(state.forSupply).to.equal(ethers.parseEther("1000"));
            expect(state.againstSupply).to.equal(ethers.parseEther("1000"));
            expect(state.reserveBalance).to.equal(ethers.parseEther("1000"));
            expect(state.lastPulseIndex).to.equal(5000n);
            expect(state.status).to.equal(0n); // ACTIVE = 0
        });

        it("Vault balance equals total initial liquidity after creation", async function () {
            await ctx.token.connect(ctx.feeRecipient).approve(await ctx.factory.getAddress(), ethers.MaxUint256);
            await ctx.factory.connect(ctx.feeRecipient).createView(
                0, "ipfs://test", ethers.ZeroHash,
                0, (await currentTime()) + 86400,
                ethers.parseEther("500"),
                ethers.parseEther("500")
            );
            const vaultBalance = await ctx.tradingEngine.getVaultBalance(1);
            expect(vaultBalance).to.equal(ethers.parseEther("1000"));
        });

        it("MIN_INITIAL_LIQUIDITY check: below 100 USDT reverts", async function () {
            await ctx.token.connect(ctx.feeRecipient).approve(await ctx.factory.getAddress(), ethers.MaxUint256);
            await expect(
                ctx.factory.connect(ctx.feeRecipient).createView(
                    0, "ipfs://test", ethers.ZeroHash,
                    0, (await currentTime()) + 86400,
                    ethers.parseEther("40"),
                    ethers.parseEther("40") // total = 80 < 100
                )
            ).to.be.revertedWithCustomError(ctx.factory, "Factory__InsufficientInitialLiquidity");
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Section 4: Trading Continuity After Initialization
    // ─────────────────────────────────────────────────────────────────────────
    describe("Section 4: Trading Continuity After Initialization", function () {

        let viewId;
        beforeEach(async function () {
            await ctx.token.connect(ctx.feeRecipient).approve(await ctx.factory.getAddress(), ethers.MaxUint256);
            await ctx.factory.connect(ctx.feeRecipient).createView(
                0, "ipfs://test", ethers.ZeroHash,
                0, (await currentTime()) + 86400,
                ethers.parseEther("500"),
                ethers.parseEther("500")
            );
            viewId = 1;
            await ctx.token.connect(ctx.userA).approve(await ctx.tradingEngine.getAddress(), ethers.MaxUint256);
            await ctx.token.connect(ctx.userB).approve(await ctx.tradingEngine.getAddress(), ethers.MaxUint256);
        });

        it("buy() succeeds immediately after initialization", async function () {
            const tx = await ctx.tradingEngine.connect(ctx.userA).buy(viewId, 0, ethers.parseEther("100"), 0);
            await expect(tx).to.emit(ctx.tradingEngine, "Bought");
        });

        it("CSM pricing is continuous: PulseIndex changes after buy", async function () {
            const stateBefore = await ctx.tradingEngine.getMarketState(viewId);
            expect(stateBefore.lastPulseIndex).to.equal(5000n);

            await ctx.tradingEngine.connect(ctx.userA).buy(viewId, 0, ethers.parseEther("100"), 0);

            const stateAfter = await ctx.tradingEngine.getMarketState(viewId);
            expect(stateAfter.lastPulseIndex).to.be.gt(5000n); // FOR buy pushes index up
        });

        it("sell() succeeds after buy (initial position holders can sell)", async function () {
            // feeRecipient holds initial shares; they should be able to sell
            const pos = await ctx.tradingEngine.getPosition(viewId, ctx.feeRecipient.address);
            expect(pos.forShares).to.be.gt(0n);

            await ctx.token.connect(ctx.feeRecipient).approve(await ctx.tradingEngine.getAddress(), ethers.MaxUint256);
            const tx = await ctx.tradingEngine.connect(ctx.feeRecipient).sell(
                viewId, 0, pos.forShares / 2n, 0
            );
            await expect(tx).to.emit(ctx.tradingEngine, "Sold");
        });

        it("Reserve invariant holds after buy then partial sell", async function () {
            // Buy 100 USDT FOR
            await ctx.tradingEngine.connect(ctx.userA).buy(viewId, 0, ethers.parseEther("100"), 0);
            const posA = await ctx.tradingEngine.getPosition(viewId, ctx.userA.address);
            // Sell only half the acquired shares to stay within CSM solvency bounds
            await ctx.tradingEngine.connect(ctx.userA).sell(viewId, 0, posA.forShares / 2n, 0);

            const state = await ctx.tradingEngine.getMarketState(viewId);
            const vaultBalance = await ctx.tradingEngine.getVaultBalance(viewId);
            // Vault balance >= reserve (fees remain in vault)
            expect(vaultBalance).to.be.gte(state.reserveBalance);
        });
    });
});
