# Pulse V1 Frontend Integration Guide

**Reference Deployment:** `v1.0.0-sepolia-live`
**Frozen Core Commit:** `be73488`
**Network:** Ethereum Sepolia (`11155111`)

This guide provides all information required for the `-V1-webapp` frontend repository to integrate with the deployed Pulse V1 Core Protocol on Sepolia.

---

## 1. Network Configuration

```javascript
const SEPOLIA_CONFIG = {
  chainId: 11155111,
  name: "Ethereum Sepolia",
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  blockExplorer: "https://sepolia.etherscan.io",
};
```

---

## 2. Contract Addresses (Sepolia)

All addresses are sourced from `deployments/sepolia.json`.

| Contract | Address |
| :--- | :--- |
| **PulseFactory** | `0x0e7592aF466DE837B700a97909E73cDF74E26D93` |
| **TradingEngine** | `0xa6EE88f610140c9934153fC0d3549930a8f60B91` |
| **FeeManager** | `0xE15FF88dB39740a7B9E46e69712F0Ad4a288dbe7` |
| **SettlementManager** | `0xB73abD77372FcD9E2Ca1D93d64A5d8163F24cC1e` |
| **PriceEngine** | `0x70A91100f52D09b021ba28B607A534ED94e3986d` |
| **MarketVaultFactory** | `0x9F9d076cdE441EeCeD011CAF0F18f2a3a48274A8` |
| **MockUSDT** | `0xDE92b9aF7FCd57ad660d7098C6a125D6594aA243` |

---

## 3. ABI Files

All ABI files are located in the `abis/` directory of this repository.

```
abis/
├── PulseFactory.json
├── TradingEngine.json
├── FeeManager.json
├── SettlementManager.json
├── PriceEngine.json
├── MarketVaultFactory.json
├── MarketVault.json
└── MockUSDT.json
```

---

## 4. createView Flow

To create a new prediction market, the caller must:

1. **Approve** `PulseFactory` to spend `totalYesLiquidity + totalNoLiquidity` of MockUSDT.
2. **Call** `PulseFactory.createView()`.

```javascript
// Step 1: Approve
await mockUSDT.approve(PULSE_FACTORY_ADDRESS, totalLiquidity);

// Step 2: Create View
const tx = await pulseFactory.createView(
  0,                    // ViewType: 0 = FIXED, 1 = PERMANENT
  "ipfs://YOUR_METADATA_URI",
  ethers.keccak256(ethers.toUtf8Bytes("metadata-hash")),
  startTime,            // Unix timestamp (0 = now)
  endTime,              // Unix timestamp (must be >= startTime + 90 minutes)
  initialYesLiquidity,  // Must equal initialNoLiquidity
  initialNoLiquidity    // Must equal initialYesLiquidity
);
const receipt = await tx.wait();
// Parse ViewCreated event to get viewId
```

**Key Constraint:** `initialYesLiquidity == initialNoLiquidity` and total must be `>= 100 MockUSDT (100000000 units)`.

---

## 5. buy Flow

```javascript
// Step 1: Approve TradingEngine
await mockUSDT.approve(TRADING_ENGINE_ADDRESS, amountIn);

// Step 2: Buy shares
// side: 0 = FOR (YES), 1 = AGAINST (NO)
const tx = await tradingEngine.buy(
  viewId,
  side,       // 0 or 1
  amountIn,   // Gross amount in MockUSDT units (1% fee deducted internally)
  minSharesOut // Slippage protection (0 = no protection)
);
```

---

## 6. sell Flow

```javascript
// No approval needed for sell (shares are internal accounting)
// side: 0 = FOR (YES), 1 = AGAINST (NO)
const tx = await tradingEngine.sell(
  viewId,
  side,
  sharesIn,     // Number of shares to sell
  minAmountOut  // Slippage protection (0 = no protection)
);
```

---

## 7. Settlement Flow

Settlement is permissionless. Any address can trigger each step.

```javascript
// Step 1: Lock market (after endTime)
await tradingEngine.lockMarket(viewId);

// Step 2: Settle market (determines winner via TWAP)
await settlementManager.settleMarket(viewId);

// Step 3: Claim reward (for any user)
await settlementManager.claimReward(viewId, userAddress);
```

---

## 8. Key Read Functions

```javascript
// Get market state
const state = await tradingEngine.marketStates(viewId);
// state.forSupply, state.againstSupply, state.reserveBalance, state.lastPulseIndex

// Get user position
const position = await tradingEngine.positions(viewId, userAddress);
// position.forShares, position.againstShares

// Get settlement result
const result = await settlementManager.getSettlementResult(viewId);
// 0 = FOR_WINS, 1 = AGAINST_WINS, 2 = DRAW

// Get claimable amount
const amount = await settlementManager.getClaimableAmount(viewId, userAddress);
```

---

*Pulse Protocol Solidity Engineer*
*2026-08-03*
