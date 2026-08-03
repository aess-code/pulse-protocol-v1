# Pulse Protocol V1 Final Freeze Baseline

**Commit:** `be73488`  
**Status:** FINAL RC FREEZE  
**Date:** August 3, 2026

## Definition

This commit (`be73488`) represents the absolute **Final Freeze Baseline** of the Pulse V1 Core Protocol.

All future development must be based on this exact commit node. Any modifications to the Core Solidity contracts will constitute a break in the freeze and require a completely new versioning and auditing cycle.

---

## 1. Frozen Core Layer

The following components and their underlying mathematical and economic assumptions are permanently frozen:

### 1.1 Contract Architecture
The scope of the Core Protocol is restricted exclusively to:
- `PulseFactory`
- `TradingEngine`
- `PriceEngine`
- `FeeManager`
- `SettlementManager`
- `MarketVaultFactory`
- `MarketVault`

### 1.2 Economic Constitution
- **`INITIAL_INDEX` = 5000**: The market always starts at a perfectly neutral state.
- **Initial Liquidity 50/50 Invariant**: Market creation strictly enforces `totalYesLiquidity == totalNoLiquidity`.
- **Shares Conversion**: `shares = liquidity * 2` is the only mechanism for initial position distribution.
- **Zero-LP Model**: Liquidity providers receive standard trading shares; there are no privileged withdrawal paths.
- **Position-Based Accounting**: Ownership is tracked strictly via `forShares` and `againstShares`.
- **FeeRecipient Model**: The protocol recognizes a single `FeeRecipient` per market, completely abstracted from application-layer concepts like "Creator".

### 1.3 Fee Model
- **`TOTAL_FEE_BPS`** = 100 (1%)
- **`FeeRecipient`** = 7000 bps (70% of total fee)
- **`Treasury`** = 2000 bps (20% of total fee)
- **`Team`** = 1000 bps (10% of total fee)
- **BPS Denominator** = 10000

### 1.4 Security Model
- **No Owner**: The protocol is completely ownerless.
- **No Admin**: There are no administrative backdoors.
- **No Upgrade**: All core contracts are immutable and non-upgradeable.
- **No Pause**: The protocol cannot be paused by any entity.
- **No Emergency Withdrawal**: Funds can only exit via standard `sell` or `claim` mechanics.
- **No Engine Custody**: `PulseFactory` and `TradingEngine` never hold user funds; all collateral resides in isolated `MarketVault`s.

### 1.5 Settlement Model
- **TWAP Parameters**: 60-minute window, 45m Phase 1, 15m Phase 2, 15-second slots.
- **Settlement Threshold**: >5000 (FOR_WINS), <5000 (AGAINST_WINS), ==5000 (DRAW).
- **Claim Mechanism**: Proportional payout based on winning shares.
- **CSM Solvency Protection**: Payouts are strictly capped by the Vault's actual reserve balance.

---

## 2. Allowed Future Changes

Development may continue **only** in the following areas, provided they do not require changes to the Frozen Core Layer:

### 2.1 Application Layer
- Frontend & UI
- User profiles and social features
- Discovery and analytics pages
- Documentation
- Deployment and operational scripts

### 2.2 External Modules
- Genesis Entry (GE) contracts
- DAO Launchpads
- Creator tools and aggregators

**CRITICAL RULE:** External Modules CANNOT modify or bypass Core economic assumptions. They must interact with the Core Protocol exclusively through its frozen public interfaces (e.g., `createViewWithInitialAllocation`).

---

## 3. Core Immutability Statement

> **Pulse V1 Core Protocol is considered immutable after FINAL RC FREEZE.**
> 
> Future improvements must be implemented as external modules or a new protocol version (V2).
> 
> The V1 economic constitution cannot be changed without creating a new protocol generation.
