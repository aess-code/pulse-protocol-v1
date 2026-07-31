# Pulse Protocol V1

Pulse Protocol V1 is a modular, decentralized prediction market protocol designed for high capital efficiency, strict security isolation, and permissionless execution.

This repository is the **Single Source of Truth** for the Pulse Protocol V1 smart contracts, containing the core architecture, tests, and documentation. It has been separated from the frontend application to serve as the baseline for independent security audits, optimization, and long-term protocol development.

## Architecture Overview

Pulse Protocol V1 adopts a highly decoupled, modular architecture enforcing the Principle of Least Privilege. The protocol separates trading execution, asset custody, fee accounting, and settlement into independent contracts.

### Core Modules

1. **PulseFactory (`PulseFactory.sol`)**
   - The global registry and sole entry point for creating prediction markets (Views).
   - Enforces the invariant: One View = One MarketVault.

2. **TradingEngine (`TradingEngine.sol`)**
   - The market orchestrator and internal position accounting layer.
   - Manages the lifecycle state machine (ACTIVE → LOCKED → SETTLEMENT → CLAIMABLE).
   - Holds no ERC20 funds and performs no complex financial math.

3. **MarketVault (`MarketVault.sol`)**
   - The sole custodian of all physical ERC20 settlement tokens.
   - Operates strictly on commands from authorized modules (`TradingEngine`, `SettlementManager`, `FeeManager`).
   - Maintains the absolute solvency invariant: `VaultBalance >= reserveBalance + unclaimedFees`.

4. **FeeManager (`FeeManager.sol`)**
   - Pure accounting module for the 1.00% protocol fee split (50% Creator, 30% Treasury, 20% Team).
   - Holds no physical assets. Uses a Pull-over-Push model to instruct the Vault to release funds.

5. **SettlementManager (`SettlementManager.sol`)**
   - Execution-only module that reads the finalized TWAP to determine the winning side.
   - Calculates proportional payouts and instructs the Vault to settle user claims.

6. **PriceEngine (`PriceEngine.sol`)**
   - Pure, stateless mathematical engine implementing the protocol's bonding curve and solvency checks.

## Market Lifecycle Flow

1. **ACTIVE**: Trading is open. Users can `buy` and `sell` position shares. TWAP snapshots are recorded periodically.
2. **LOCKED**: Once `endTime` is reached, anyone can call `TradingEngine.lockMarket()` to finalize the TWAP and halt trading.
3. **SETTLEMENT**: Anyone can call `SettlementManager.settleMarket()` to read the finalized TWAP, determine the winner (FOR, AGAINST, or DRAW), and advance the state.
4. **CLAIMABLE**: Winners and fee recipients can permissionlessly claim their payouts.

## Security Principles

- **Zero Direct Custody by Logic Contracts**: Neither `TradingEngine` nor `FeeManager` hold user funds.
- **Checks-Effects-Interactions (CEI)**: Strictly enforced globally to prevent reentrancy.
- **Permissionless Crank**: State transitions (`lockMarket`, `settleMarket`) and reward claims can be executed by any untrusted caller.
- **Vault Quota Protection**: The Vault independently verifies that the `FeeManager` cannot over-release fees.
- **Solvency Math**: `PriceEngine` mathematically guarantees `min(forSupply, againstSupply) <= reserveBalance` at all times.

## Current Status

**Stage 6.5: Security Hardened (Official V1 Baseline)**
- All core modules are fully implemented and architecturally frozen.
- All vulnerabilities discovered during the Stage 6 Independent Security Audit have been fixed.
- The protocol achieves 100% test coverage with 92/92 passing tests (including security regression tests).
- This repository represents the current official V1 baseline for all future development.

## Development Environment

This repository uses Hardhat for compilation and testing.

```bash
# Install dependencies
pnpm install

# Compile contracts
pnpm run compile

# Run full test suite
pnpm run test

# Run tests with gas report
pnpm run test:gas
```
