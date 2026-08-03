# Pulse V1 Developer API Reference Documentation

## 1. Protocol Overview

Pulse V1 Core is the immutable execution layer for Continuous Scoring Markets (CSM).

**Core responsibilities:**
- Market creation and registry
- Continuous trading execution and pricing
- Internal position accounting
- Collateral custody and settlement

**External module boundary:**
Core only understands protocol-level primitives:
- Market
- Position
- Liquidity
- Vault
- FeeRecipient

Core does NOT understand application-layer concepts:
- Creator
- Builder
- GE
- DAO
- Application logic

External modules must integrate strictly through the defined Core interfaces and respect all economic invariants.

---

## 2. Contract Interface Map

### PulseFactory

**Role:** Market creation entry point.

**Constructor dependencies:**
- `vaultFactory`: Deploys per-View vaults
- `tradingEngine`: Shared trading execution layer
- `settlementManager`: Shared settlement layer
- `feeManager`: Shared fee accounting layer
- `settlementToken`: ERC20 token used for settlement (e.g., USDT)
- `minInitialLiquidity`: Minimum total initial liquidity (YES + NO)

**Public functions:**

#### `createView()`
Direct market creation for EOA users. `feeRecipient` is automatically set to `msg.sender`.

#### `createViewWithInitialAllocation()`
Market creation for External Modules. Allows specifying a `feeRecipient` and a breakdown of initial allocations.

**Required invariant:**
`totalYesLiquidity == totalNoLiquidity`

**Failure:**
If the invariant is violated, the transaction reverts with `TradingEngine__AllocationMismatch()`.

**Validation rules:**
- `endTime >= startTime + SETTLEMENT_WINDOW + MIN_TRADING_DURATION` (Minimum 90 minutes total)
- `totalYesLiquidity + totalNoLiquidity >= MIN_INITIAL_LIQUIDITY`

**Emitted events:**
- `ViewCreated(uint256 indexed viewId, address indexed feeRecipient, ViewType viewType, address vault, uint256 endTime)`

---

### TradingEngine

**Responsibilities:**
- initialize market state
- buy
- sell
- position accounting
- lifecycle transitions

**Public functions:**

#### `initializeMarketState()`
**Input:** `viewId`, `totalYesLiquidity`, `totalNoLiquidity`, `allocations` array.
**State changes:** Initializes `MarketState`, creates initial Position Shares (`shares = liquidity * 2`), sets status to `ACTIVE`.
**Failure conditions:** Reverts with `TradingEngine__AllocationMismatch` if `totalYesLiquidity != totalNoLiquidity`.

#### `buy()`
**Input:** `viewId`, `side` (0 = FOR, 1 = AGAINST), `amountIn`, `minSharesOut`.
**Output:** `sharesOut`
**State changes:** Updates `forSupply`/`againstSupply`, `reserveBalance`, `lastPulseIndex`, transfers tokens to Vault, records fee.
**Events:** `Bought`, `PulseIndexUpdated`.
**Failure conditions:** `TradingEngine__MarketNotActive`, `TradingEngine__SlippageExceeded`.

#### `sell()`
**Input:** `viewId`, `side`, `sharesIn`, `minAmountOut`.
**Output:** `amountOut`
**State changes:** Burns shares, updates `reserveBalance`, withdraws tokens from Vault, records fee.
**Events:** `Sold`, `PulseIndexUpdated`.
**Failure conditions:** `TradingEngine__MarketNotActive`, `TradingEngine__InsufficientPosition`, `PriceEngine__SolvencyViolation`.

#### Settlement related functions
- `lockMarket(viewId)`: Advances status to `LOCKED`. Emits `MarketLocked`, `TWAPFinalised`.
- `setStatusSettlement(viewId)`: Advances status to `SETTLEMENT`.
- `setStatusClaimable(viewId)`: Advances status to `CLAIMABLE`.

---

### PriceEngine

**CSM pricing model:**
Stateless continuous pricing algorithm. Provides continuous two-way quoting with no price lockup and no external LP required.

**Index calculation:**
The Pulse Index represents the current market probability, expressed in basis points (0-10000).

**INITIAL_INDEX = 5000**
Meaning: Neutral fair launch state. The market always starts perfectly balanced.

**Price boundaries:**
Enforces the Capped Payout invariant to ensure solvency.

---

### FeeManager

**Fee model:**
`TOTAL_FEE_BPS = 100`
Meaning: 1% trading fee on gross input/output amounts.

**Distribution:**
- `FEE_RECIPIENT_SHARE_BPS = 7000` (70% of the 1% fee)
- `TREASURY_SHARE_BPS = 2000` (20% of the 1% fee)
- `TEAM_SHARE_BPS = 1000` (10% of the 1% fee)

**FeeRecipient is a protocol level abstraction.** It receives 70% of the trading fees. How this is distributed further is an application-layer concern outside of Core.

---

### SettlementManager

**TWAP settlement:**
- **Window:** 60 minutes
- **Phase1:** 45 minutes
- **Phase2:** 15 minutes
- **Slot:** 15 seconds

**Settlement rules:**
- Index > 5000: FOR wins
- Index < 5000: AGAINST wins
- Index == 5000: DRAW

---

### MarketVault

**Isolated custody model:**
One View = One Vault. Collateral is strictly isolated per market.

**No admin withdrawal:**
There are no privileged withdrawal paths.

**Only protocol controlled settlement paths:**
Funds leave the vault only through `TradingEngine.sell()` or `SettlementManager.claimReward()`.

---

## 3. Protocol Economic Rules

### Initial Liquidity
Always: `YES liquidity = NO liquidity`

### Initial Shares
Formula: `shares = liquidity * 2`

### Initial Index
Always: `5000`

### Zero-LP Model
Liquidity providers receive normal Position Shares. There is no LP Token, no `removeLiquidity()` function, and no privileged withdrawal mechanism.

### Solvency Protection
CSM invariant: `min(F,A) <= R`
(The minimum of For Supply and Against Supply must be less than or equal to the Reserve Balance).

---

## 4. Integration Flow Examples

### Market Creation Flow
External caller:
↓
PulseFactory
↓
MarketVault creation
↓
TradingEngine initialization
↓
Initial state ready

### Trading Flow
User: approve token
↓
buy()
↓
Position update
↓
Vault balance update

### Exit Flow
sell()
↓
shares burned
↓
USDT returned

### Settlement Flow
TWAP
↓
SettlementManager
↓
claim()

---

## 5. Events Reference

- `ViewCreated`: Emitted by PulseFactory when a new market is registered.
- `Bought`: Emitted by TradingEngine when a user buys position shares.
- `Sold`: Emitted by TradingEngine when a user sells position shares.
- `PulseIndexUpdated`: Emitted by TradingEngine after any trade alters the index.
- `MarketLocked`: Emitted by TradingEngine when trading is halted and TWAP is finalized.
- `MarketSettled`: Emitted by SettlementManager when the winner is determined.
- `RewardClaimed`: Emitted by SettlementManager when a user receives their payout.

---

## 6. Errors Reference

- `TradingEngine__AllocationMismatch()`: Triggered during market initialization if `totalYesLiquidity != totalNoLiquidity` or if allocation sums do not match the declared totals.
- `PriceEngine__SolvencyViolation()`: Triggered during `sell()` if the trade would cause the protocol to owe more than the reserve holds (`min(F,A) > R`).
- `Factory__DurationTooShort()`: Triggered if `endTime` is less than `startTime + 90 minutes`.

---

## 7. External Module Rules

External modules **can**:
- call Core interfaces
- build applications
- provide UI

External modules **cannot**:
- bypass invariants
- modify Core
- control Vault funds

---

## 8. Security Assumptions

No:
- Owner
- Admin
- Upgrade
- Pause
- Emergency withdrawal

---

## 9. Version Information

**Protocol:** Pulse V1 Core
**Frozen baseline:** `be73488`
**Status:** FINAL RC FREEZE
