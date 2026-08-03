# Pulse Protocol V1 Core Interface Specification

## 1. Protocol Identity

Pulse Protocol V1 Core is the immutable execution layer for Continuous Scoring Markets (CSM). 

The frozen Core consists of:
- `PulseFactory`
- `TradingEngine`
- `PriceEngine`
- `FeeManager`
- `SettlementManager`
- `MarketVaultFactory`
- `MarketVault`

Supporting libraries:
- `MathLibrary`
- `TWAPLibrary`

---

## 2. Core Boundary Definition

Pulse V1 Core recognizes only protocol-level primitives:
- Market
- Position Accounting
- Liquidity
- MarketVault
- Settlement State
- FeeRecipient

The Core MUST NOT contain application-layer concepts:
- Creator
- Builder
- Genesis
- GE
- DAO
- Launchpad
- Campaign

External modules may exist outside Core. They must interact only through frozen Core interfaces.

---

## 3. ABI Freeze Scope

The following interface surfaces are frozen:

### External Functions
Including function signatures, parameters, and return values.

### Events
Including event names, indexed fields, and parameters.

### Custom Errors
Including error names and parameters.

### Public Structs
Including field order and field types.

### Enums
Including definitions and ordering.

Any incompatible modification requires a new protocol version.

---

## 4. Contract Responsibilities

### PulseFactory

**Purpose:** Protocol market creation entry point.

**Responsibilities:**
- Create markets
- Coordinate Core dependencies
- Connect market components

**PulseFactory does NOT:**
- Calculate trading price
- Execute trading logic
- Resolve markets
- Custody user funds

### TradingEngine

**Purpose:** Trading and position accounting engine.

**Responsibilities:**
- Market initialization
- Buy operations
- Sell operations
- Position accounting
- Trading state management

**TradingEngine does NOT:**
- Hold collateral
- Resolve outcomes
- Execute payout calculations

### PriceEngine

**Purpose:** Pure pricing calculation authority.

**Responsibilities:**
- CSM pricing calculations
- Share conversion calculations
- Solvency boundary verification

### FeeManager

**Purpose:** Fee accounting and distribution.

**Important distinction:**

#### Trading Fee Rate
Frozen TOTAL TRADE FEE: 100 BPS = 1%
Calculation: 100 / 10000 = 1%

#### Fee Distribution
The collected trading fee is distributed:
- FeeRecipient: 7000 BPS
- Treasury: 2000 BPS
- Team: 1000 BPS

These values describe distribution of collected fees. They do NOT represent trading fee percentages.

### SettlementManager

**Purpose:** Market resolution and claim processing.

**Responsibilities:**
- TWAP settlement
- Winner determination
- Claim handling

**Settlement threshold:**
- TWAP > 5000: FOR wins
- TWAP < 5000: AGAINST wins
- TWAP == 5000: DRAW

Payouts are limited by actual MarketVault reserve.

### MarketVaultFactory

**Purpose:** Deploy isolated MarketVault instances.

**Responsibilities:**
- Vault deployment
- Vault association

### MarketVault

**Purpose:** Isolated collateral storage.

**Security properties:**
- No privileged withdrawal path
- No arbitrary fund extraction

Funds leave only through protocol-defined flows: `sell()`, `claim()`.

---

## 5. Market Initialization Constitution

### Initial Index
Frozen: `INITIAL_INDEX = 5000`
Meaning: Neutral initial market state.

### Initial Liquidity Invariant
During market creation:
`YES Initial Liquidity = NO Initial Liquidity`

This is enforced by Core. This rule applies to every caller: EOA, External Module, Future integrations. This is NOT an application-layer rule.

Important: The 50/50 requirement exists ONLY during initialization. During normal trading, YES and NO supply may diverge.

---

## 6. Initial Position Conversion

Frozen initialization rule:
`Initial Position Shares = Initial Liquidity × 2`

This rule applies only to initial market creation. It does NOT define normal buy/sell pricing.

---

## 7. Position Accounting Model

Pulse V1 does NOT use:
- ERC20 share tokens
- ERC1155 positions
- transferable LP tokens

Positions are internal accounting records. Tracked through FOR shares and AGAINST shares. Positions are not independently transferable.

---

## 8. Zero-LP Model

Pulse V1 does not implement traditional LP tokens. Initial liquidity contributors receive internal market positions. They do NOT receive an LP token or a privileged withdrawal function.

Exit occurs through `sell()` subject to CSM Solvency Boundary.

---

## 9. FeeRecipient Model

Core stores FeeRecipient address. Core does NOT know creator identity, builder identity, or application purpose. Core only performs fee accounting according to frozen rules.

---

## 10. Security Model

Frozen guarantees:

### No Owner
No owner-controlled administration.

### No Upgrade
No upgrade mechanism exists.

### No Pause
No emergency pause mechanism exists.

### No Token Custody
Factory and TradingEngine do not custody user funds. Collateral remains inside MarketVault.

---

## 11. TWAP Settlement Parameters

Frozen:
- Observation Window: 60 minutes
- Phase 1: 45 minutes
- Phase 2: 15 minutes
- Slot Duration: 15 seconds

---

## 12. Version Freeze Statement

Pulse Protocol V1 Core Interface is frozen. Any incompatible modification requires a new protocol version. Future expansion must occur through external modules or V2.
