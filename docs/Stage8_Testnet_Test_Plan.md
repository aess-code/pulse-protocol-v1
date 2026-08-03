# Pulse Protocol V1 — Stage 8 Testnet Test Plan

## 1. Market Creation Tests

### 1.1 Fixed Markets
- **Scenario**: Create a market with a specific `startTime` and `endTime`.
- **Validation**: 
    - `endTime >= startTime + 90 minutes` (60m window + 30m trading).
    - `MarketVault` is deployed correctly.
    - `ViewRecord` is stored in `PulseFactory`.

### 1.2 Permanent Markets
- **Scenario**: Create a market with `endTime = 0`.
- **Validation**:
    - `viewType` is set to `PERMANENT`.
    - Market remains `ACTIVE` indefinitely.
    - `lockMarket()` reverts on this view.

---

## 2. Trading Operations

### 2.1 Buying (FOR/AGAINST)
- **Scenario**: Users buy shares on both sides.
- **Validation**:
    - `PulseIndex` moves according to the CSM formula.
    - `MarketVault` receives the correct amount of ERC20 tokens.
    - User's `PositionShare` is recorded in `TradingEngine`.

### 2.2 Selling
- **Scenario**: Users sell their shares before the market is locked.
- **Validation**:
    - `PulseIndex` moves in the opposite direction.
    - `MarketVault` sends the correct net amount to the user.
    - Protocol fees (1%) are correctly recorded in `FeeManager`.

### 2.3 Slippage Protection
- **Scenario**: Execute a `buy` with `minSharesOut` higher than the quote.
- **Validation**: Transaction must revert with `TradingEngine__SlippageExceeded`.

---

## 3. TWAP & Settlement

### 3.1 TWAP Recording
- **Scenario**: Perform trades at different intervals within the settlement window.
- **Validation**: `TWAPLibrary` correctly records snapshots and fills forward missing slots.

### 3.2 Market Locking
- **Scenario**: Call `lockMarket()` after `endTime`.
- **Validation**:
    - Status changes to `LOCKED`.
    - Final TWAP is computed and stored.
    - Trading functions (`buy`, `sell`) are disabled.

### 3.3 Settlement Execution
- **Scenario**: Call `settleMarket()` on a `LOCKED` market.
- **Validation**:
    - Status changes to `SETTLEMENT` then `CLAIMABLE`.
    - Winning side (FOR, AGAINST, or DRAW) is correctly determined based on TWAP.

---

## 4. Payouts & Fees

### 4.1 Reward Claiming
- **Scenario**: Winners claim their rewards.
- **Validation**:
    - `MarketVault.settle()` is called.
    - User receives the correct proportional payout.
    - `PositionShare` is marked as claimed.

### 4.2 Fee Claiming
- **Scenario**: Creator, Treasury, and Team claim their respective fees.
- **Validation**:
    - `FeeManager` correctly splits the 100 bps (50/30/20).
    - `MarketVault.releaseFee()` transfers the correct amounts.
    - Quota check in `MarketVault` prevents over-releasing.

---

## 5. Edge Cases & Attack Simulations

### 5.1 Empty Market Settlement
- **Scenario**: A market with no trades reaches `endTime` and is settled.
- **Validation**: Must result in a `DRAW`. Payouts should be zero or handle empty supply gracefully.

### 5.2 Reentrancy Attacks
- **Scenario**: Attempt to reenter `settleMarket()` or `claimReward()` via a malicious ERC20 token.
- **Validation**: Must revert due to `nonReentrant` modifier.

### 5.3 Flash Loan Price Manipulation
- **Scenario**: Use a large amount of capital to swing the `PulseIndex` just before `endTime`.
- **Validation**: The 60-minute TWAP window should significantly dampen the impact of single-block manipulation.

---

## 6. Performance & Gas Verification

### 6.1 Gas Benchmarking
- **Scenario**: Execute `lockMarket()` with the maximum possible fill-forward slots (240 slots for 60 minutes).
- **Validation**: Gas consumption should be ~250k gas, well within limits.

### 6.2 Stress Testing
- **Scenario**: Rapidly create 50+ markets and perform simultaneous trades.
- **Validation**: No state corruption; `PulseFactory` correctly increments `ViewID`.

---

## 7. Success Criteria

- **Functional**: 100% of test scenarios pass on Sepolia.
- **Security**: No unexpected reverts or unauthorized fund movements.
- **Economic**: Payouts and fees match the mathematical specifications in `Economic_Model_Specification.md`.
- **Operational**: Deployment sequence is verified as repeatable.
