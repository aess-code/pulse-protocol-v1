# Pulse V1 Deployment Guide

**Frozen Baseline:** `be73488`
**Status:** FINAL RC FREEZE

This document records the constructor dependencies of the Pulse V1 Core contracts as defined in the frozen Solidity code. It does not contain a deployment script or deployment orchestration plan.

---

## 1. Prerequisites

Before beginning deployment, ensure the following parameters are determined:

| Parameter | Description |
|-----------|-------------|
| Settlement Token Address | The ERC20 token used for all markets (e.g., USDT, 6 decimals). |
| Treasury Address | The protocol treasury address receiving 20% of trading fees. |
| Team Address | The team wallet address receiving 10% of trading fees. |
| Minimum Initial Liquidity | The minimum total liquidity (YES + NO) required to create a market, in settlement token units (e.g., `100 * 10^6` for 100 USDT with 6 decimals). |

---

## 2. Constructor Dependencies

The following table records the constructor parameters for each Core contract exactly as defined in the frozen Solidity code at `be73488`.

| Contract | Constructor Parameters |
|----------|----------------------|
| `PriceEngine` | None |
| `MarketVaultFactory` | `address _authorizedFactory` |
| `TradingEngine` | `address _factory`, `address _priceEngine`, `address _feeManager` |
| `FeeManager` | `address _authorizedTradingEngine`, `address _factory`, `address _treasury`, `address _team` |
| `SettlementManager` | `address _tradingEngine`, `address _factory` |
| `PulseFactory` | `address _vaultFactory`, `address _tradingEngine`, `address _settlementManager`, `address _feeManager`, `address _settlementToken`, `uint256 _minInitialLiquidity` |

---

## 3. Circular Dependency Notice

**Not Defined in V1 Core.**

The V1 Core Solidity contracts define constructor dependencies, but V1 Core does not include an official deployment script or deployment orchestration plan.

The following circular dependency exists between the Core contracts:

- `TradingEngine` constructor requires a `FeeManager` address.
- `FeeManager` constructor requires a `TradingEngine` address (`_authorizedTradingEngine`).
- `TradingEngine` constructor requires a `PulseFactory` address.
- `PulseFactory` constructor requires a `TradingEngine` address.
- `MarketVaultFactory` constructor requires a `PulseFactory` address.
- `SettlementManager` constructor requires a `TradingEngine` address and a `PulseFactory` address.

The method for resolving these circular dependencies (e.g., nonce prediction, `CREATE2`, proxy patterns, or multi-step deployment scripts) is part of the **Deployment Tooling Layer** and is not defined in the frozen V1 Core Protocol.

Future deployment orchestration must be defined in a separate deployment repository or deployment script, outside of the frozen Core.

---

## 4. Post-Deployment Verification

After all contracts are deployed, verify the immutable links by calling the following read functions and confirming each address matches the corresponding deployed contract:

| Call | Expected Result |
|------|----------------|
| `PulseFactory.tradingEngine()` | Deployed TradingEngine address |
| `PulseFactory.feeManager()` | Deployed FeeManager address |
| `PulseFactory.settlementManager()` | Deployed SettlementManager address |
| `PulseFactory.vaultFactory()` | Deployed MarketVaultFactory address |
| `TradingEngine.factory()` | Deployed PulseFactory address |
| `TradingEngine.feeManager()` | Deployed FeeManager address |
| `TradingEngine.priceEngine()` | Deployed PriceEngine address |
| `FeeManager.authorizedTradingEngine()` | Deployed TradingEngine address |
| `MarketVaultFactory.authorizedFactory()` | Deployed PulseFactory address |
| `SettlementManager.tradingEngine()` | Deployed TradingEngine address |

If all links match, the V1 Core Protocol is correctly wired and ready for market creation.

---

## 5. Deployment Tooling

**Not Defined in V1 Core.**

Deployment scripts, migration tooling, testnet configuration, and mainnet deployment procedures are not part of the frozen Core Protocol. They must be maintained in a separate deployment repository.
