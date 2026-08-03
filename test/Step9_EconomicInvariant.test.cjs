// SPDX-License-Identifier: MIT
// ─────────────────────────────────────────────────────────────────────────────
// Step 9 Economic Invariant Tests
// Validates the Fair Launch 50/50 constraint in TradingEngine.initializeMarketState()
// ─────────────────────────────────────────────────────────────────────────────
const { expect } = require("chai");
const { ethers } = require("hardhat");

async function currentTime() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp;
}

async function deployProtocol() {
    const [owner, feeRecipient, userA, userB, treasury, team] = await ethers.getSigners();

    const PriceEngine = await ethers.getContractFactory("PriceEngine");
    const priceEngine = await PriceEngine.deploy();

    const MockToken = await ethers.getContractFactory("MockUSDT");
    const token = await MockToken.deploy();

    const deployerAddr = owner.address;
    const nonce = await owner.getNonce();

    const factoryAddr           = ethers.getCreateAddress({ from: deployerAddr, nonce });
    const vaultFactoryAddr      = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 1 });
    const tradingEngineAddr     = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 2 });
    const feeManagerAddr        = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 3 });
    const settlementManagerAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 4 });

    const PulseFactory = await ethers.getContractFactory("PulseFactory");
    const factory = await PulseFactory.deploy(
        vaultFactoryAddr, tradingEngineAddr, settlementManagerAddr,
        feeManagerAddr, await token.getAddress(), ethers.parseEther("100")
    );

    const MarketVaultFactory = await ethers.getContractFactory("MarketVaultFactory");
    await MarketVaultFactory.deploy(factoryAddr);

    const TradingEngine = await ethers.getContractFactory("TradingEngine");
    const tradingEngine = await TradingEngine.deploy(
        factoryAddr, await priceEngine.getAddress(), feeManagerAddr
    );

    const FeeManager = await ethers.getContractFactory("FeeManager");
    await FeeManager.deploy(tradingEngineAddr, factoryAddr, treasury.address, team.address);

    const SettlementManager = await ethers.getContractFactory("SettlementManager");
    await SettlementManager.deploy(tradingEngineAddr, factoryAddr);

    for (const user of [owner, feeRecipient, userA, userB]) {
        await token.mint(user.address, ethers.parseEther("1000000"));
        await token.connect(user).approve(await tradingEngine.getAddress(), ethers.MaxUint256);
        await token.connect(user).approve(await factory.getAddress(), ethers.MaxUint256);
    }

    return { factory, tradingEngine, token, owner, feeRecipient, userA, userB };
}

async function createMarket(ctx, yesLiq, noLiq) {
    const now = await currentTime();
    const endTime = now + 2 * 3600;
    const tx = await ctx.factory.connect(ctx.feeRecipient).createView(
        0, "ipfs://test", ethers.ZeroHash, 0, endTime, yesLiq, noLiq
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find(l => {
        try { return ctx.factory.interface.parseLog(l)?.name === "ViewCreated"; } catch { return false; }
    });
    return ctx.factory.interface.parseLog(event).args.viewId;
}

async function createMarketWithAlloc(ctx, yesLiq, noLiq, allocations) {
    const now = await currentTime();
    const endTime = now + 2 * 3600;
    return ctx.factory.connect(ctx.feeRecipient).createViewWithInitialAllocation(
        0, "ipfs://test", ethers.ZeroHash, 0, endTime,
        ctx.feeRecipient.address, yesLiq, noLiq, allocations
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
describe("Step 9 — Economic Invariant: Fair Launch 50/50 Constraint", function () {
    let ctx;
    beforeEach(async function () { ctx = await deployProtocol(); });

    // ── Case A: YES=500 NO=500 → success ─────────────────────────────────────
    it("Case A: YES=500 NO=500 succeeds and Index=5000", async function () {
        const viewId = await createMarket(ctx, ethers.parseEther("500"), ethers.parseEther("500"));
        const state = await ctx.tradingEngine.getMarketState(viewId);
        expect(state.forSupply).to.equal(ethers.parseEther("1000"));
        expect(state.againstSupply).to.equal(ethers.parseEther("1000"));
        expect(state.lastPulseIndex).to.equal(5000n);
        expect(state.reserveBalance).to.equal(ethers.parseEther("1000"));
    });

    // ── Case B: YES=600 NO=400 → revert ──────────────────────────────────────
    it("Case B: YES=600 NO=400 reverts with AllocationMismatch", async function () {
        await expect(
            createMarket(ctx, ethers.parseEther("600"), ethers.parseEther("400"))
        ).to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__AllocationMismatch");
    });

    // ── Case C: YES=990 NO=10 → revert ───────────────────────────────────────
    it("Case C: YES=990 NO=10 reverts with AllocationMismatch", async function () {
        await expect(
            createMarket(ctx, ethers.parseEther("990"), ethers.parseEther("10"))
        ).to.be.revertedWithCustomError(ctx.tradingEngine, "TradingEngine__AllocationMismatch");
    });

    // ── Case D: Duplicate Allocation with 50/50 → success ────────────────────
    it("Case D: Duplicate Allocation addresses with 50/50 total succeeds", async function () {
        const allocations = [
            { user: ctx.userA.address, yesLiquidity: ethers.parseEther("25"), noLiquidity: ethers.parseEther("25") },
            { user: ctx.userA.address, yesLiquidity: ethers.parseEther("25"), noLiquidity: ethers.parseEther("25") },
            { user: ctx.userB.address, yesLiquidity: ethers.parseEther("50"), noLiquidity: ethers.parseEther("50") }
        ];
        const tx = await createMarketWithAlloc(
            ctx,
            ethers.parseEther("100"),
            ethers.parseEther("100"),
            allocations
        );
        const receipt = await tx.wait();
        const event = receipt.logs.find(l => {
            try { return ctx.factory.interface.parseLog(l)?.name === "ViewCreated"; } catch { return false; }
        });
        const viewId = ctx.factory.interface.parseLog(event).args.viewId;
        const state = await ctx.tradingEngine.getMarketState(viewId);
        expect(state.lastPulseIndex).to.equal(5000n);
        // userA: 25+25=50 YES, 50 NO → shares = 100 YES, 100 NO
        const posA = await ctx.tradingEngine.getPosition(viewId, ctx.userA.address);
        expect(posA.forShares).to.equal(ethers.parseEther("100"));
        expect(posA.againstShares).to.equal(ethers.parseEther("100"));
    });

    // ── Case E: Normal buy/sell after 50/50 init → unchanged ─────────────────
    it("Case E: Normal buy/sell flow works after 50/50 initialization", async function () {
        const viewId = await createMarket(ctx, ethers.parseEther("500"), ethers.parseEther("500"));
        // Buy FOR
        await ctx.tradingEngine.connect(ctx.userA).buy(viewId, 0, ethers.parseEther("100"), 0);
        const stateAfterBuy = await ctx.tradingEngine.getMarketState(viewId);
        expect(stateAfterBuy.lastPulseIndex).to.be.gt(5000n); // Index increased

        // Sell half of acquired shares
        const pos = await ctx.tradingEngine.getPosition(viewId, ctx.userA.address);
        await ctx.tradingEngine.connect(ctx.userA).sell(viewId, 0, pos.forShares / 2n, 0);
        const stateAfterSell = await ctx.tradingEngine.getMarketState(viewId);
        expect(stateAfterSell.reserveBalance).to.be.gt(0n);
        expect(stateAfterSell.lastPulseIndex).to.be.gt(0n).and.to.be.lt(10000n);
    });
});
