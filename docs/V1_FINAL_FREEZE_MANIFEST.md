# Pulse Protocol V1 Final Freeze Manifest

**Author:** Pulse Protocol Solidity Protocol Engineer (Manus AI)  
**Date:** August 3, 2026  
**Commit:** `be73488`  
**Status:** FINAL RC FREEZE

This manifest serves as the ultimate source of truth for the frozen architecture, parameters, and security boundaries of Pulse Protocol V1 prior to mainnet deployment.

---

## 1. Contract Inventory

The core protocol consists of the following smart contracts:

| Contract Name | Role |
|--------------|------|
| `PulseFactory` | The registry and entry point for market creation. |
| `TradingEngine` | The state machine for market lifecycle, positions, and trades. |
| `PriceEngine` | The pure math library for the Constant Sum Market (CSM) pricing. |
| `FeeManager` | The accounting ledger for protocol fees and revenue splits. |
| `SettlementManager` | The oracle resolution and claim settlement engine. |
| `MarketVaultFactory` | Factory for deploying isolated vaults. |
| `MarketVault` | The isolated, zero-admin custody vault for each market. |
| `MathLibrary` | Safe arithmetic and basis points helpers. |
| `TWAPLibrary` | Discrete time-weighted average price (TWAP) calculation logic. |

### Deployment Order & Constructor Parameters
To resolve circular dependencies, the following deployment sequence is required:

1. **Deploy `PriceEngine`** (No args)
2. **Deploy `MarketVaultFactory`** (Args: Predicted `PulseFactory` address)
3. **Deploy `TradingEngine`** (Args: Predicted `PulseFactory`, `PriceEngine`, Predicted `FeeManager`)
4. **Deploy `FeeManager`** (Args: `TradingEngine`, Predicted `PulseFactory`, `Treasury Multisig`, `Team Multisig`)
5. **Deploy `SettlementManager`** (Args: `TradingEngine`, Predicted `PulseFactory`)
6. **Deploy `PulseFactory`** (Args: `MarketVaultFactory`, `TradingEngine`, `SettlementManager`, `FeeManager`, `SettlementToken`, `MIN_INITIAL_LIQUIDITY`)

---

## 2. Immutable Parameters

The following constants and immutable variables are hardcoded into the protocol and cannot be changed after deployment:

### Trading & Math
- `INITIAL_INDEX` = 5000 (Fair Launch neutral state)
- `MIN_PULSE_INDEX` = 1
- `MAX_PULSE_INDEX` = 9999
- `MIN_INITIAL_LIQUIDITY` = Configured at deployment (e.g., 100 * 10^6 for USDT)

### Fees (Basis Points: 10000 = 100%)
- `TOTAL_FEE_BPS` = 100 (1% total trade fee)
- `FEE_RECIPIENT_SHARE_BPS` = 7000 (70% of total fee)
- `TREASURY_SHARE_BPS` = 2000 (20% of total fee)
- `TEAM_SHARE_BPS` = 1000 (10% of total fee)

### TWAP & Settlement
- `OBSERVATION_WINDOW` = 60 minutes
- `PHASE1_DURATION` = 45 minutes (180 slots)
- `PHASE2_DURATION` = 15 minutes (60 slots)
- `SLOT_DURATION` = 15 seconds
- `TOTAL_SLOTS` = 240
- `MAX_LOCK_DELAY_BLOCKS` = 150 blocks

---

## 3. Economic Constitution

The protocol enforces the following absolute economic invariants:

1. **50/50 Initial Liquidity Invariant**: Any market creation, regardless of the caller (GE, DAO, or EOA), MUST provide exactly equal amounts of YES and NO liquidity (`totalYesLiquidity == totalNoLiquidity`). This guarantees the market always starts at the `INITIAL_INDEX` (5000).
2. **Shares Conversion**: Initial liquidity is converted to Position Shares using the strict formula: `shares = liquidity * 2`. The protocol never relies on dynamic price discovery for the initial state.
3. **Zero-LP Model**: Initial liquidity providers receive standard Position Shares (FOR and AGAINST). There is no special "withdraw liquidity" function. Providers must exit via standard `sell()` operations, subject to the CSM Solvency boundary (`min(F,A) <= R`).
4. **FeeRecipient Model**: The protocol recognizes a `FeeRecipient` (immutable per market) who permanently receives 70% of the trading fees. The protocol is entirely unaware of application-layer concepts like "Creator", "Builder", or "Genesis".

---

## 4. Security Guarantees

Pulse V1 is designed as an unstoppable, trustless protocol:

- **No Owner / No Admin**: There are no `onlyOwner` or `admin` modifiers in the core contracts.
- **No Upgradeability**: All contracts are immutable. There are no proxy patterns.
- **No Pause**: The protocol cannot be paused by any entity.
- **No Token Custody in Engines**: `PulseFactory` and `TradingEngine` never hold user funds. All collateral is sent directly from `msg.sender` to the isolated `MarketVault`.
- **No Admin Withdrawal**: Funds in the `MarketVault` can only be withdrawn via mathematically proven `sell()` or `claimReward()` paths.

---

## 5. Deployment Checklist

Before mainnet launch, the following steps must be completed:

- [ ] **Testnet Rehearsal**: Execute the exact deployment script on a testnet (e.g., Arbitrum Sepolia) to verify the address prediction logic for circular dependencies.
- [ ] **Multisig Preparation**: Create and secure the Gnosis Safe (or equivalent) multisig wallets for the `Treasury` and `Team` addresses.
- [ ] **Token Verification**: Confirm the exact address and decimals of the target `SettlementToken` (e.g., USDT).
- [ ] **Source Verification**: Ensure all contracts are verified on the block explorer immediately after deployment.
- [ ] **External Audit**: Provide this manifest, the `Pulse_V1_Final_RC_Audit_Report.md`, and the codebase to the external auditing firm.
