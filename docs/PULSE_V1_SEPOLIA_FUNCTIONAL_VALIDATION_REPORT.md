# Pulse V1 Sepolia Post Deployment Functional Validation Report

**Network:** Ethereum Sepolia (`11155111`)
**Validation Target:** Frozen Core (`be73488`) Deployed on Sepolia
**Status:** **ALL CHECKS PASSED (21/21)**

This document details the on-chain functional validation of the deployed Pulse V1 Core Protocol. The validation script executed a complete market lifecycle including creation, buying, and selling, while continuously asserting all economic invariants.

## 1. Market Creation (createView)

A new `FIXED` market (`viewId = 1`) was successfully created via `PulseFactory.createView()`.

| Check | Result | Details |
| :--- | :--- | :--- |
| **MIN_INITIAL_LIQUIDITY** | **PASS** | Initial liquidity provided was 100 USDT (each side), satisfying the 100,000,000 unit minimum. |
| **50/50 Invariant** | **PASS** | `forSupply == againstSupply` (`200000000 == 200000000`). |
| **Shares Formula** | **PASS** | `shares = liquidity * 2` (`200000000 == 100000000 * 2`). |
| **INITIAL_INDEX** | **PASS** | Market initialized exactly at `5000`. |
| **Reserve Balance** | **PASS** | `reserveBalance` equals total initial liquidity (`200000000`). |

## 2. Trading Execution: BUY

A buy operation was executed for `10 USDT` on the `FOR` (YES) side.

| Metric | Pre-Trade | Post-Trade | Delta |
| :--- | :--- | :--- | :--- |
| **FOR Shares** | `200,000,000` | `219,800,000` | `+19,800,000` |
| **AGAINST Shares** | `200,000,000` | `200,000,000` | `0` |
| **Reserve Balance** | `200,000,000` | `209,900,000` | `+9,900,000` (10 USDT - 1% fee) |
| **Pulse Index** | `5000` | `5235` | `+235` BPS |

**Solvency Check (PASS):** `min(F,A) <= R`
`min(219,800,000, 200,000,000) = 200,000,000 <= 209,900,000`

## 3. Trading Execution: SELL

A sell operation was executed, burning half of the user's `FOR` shares (`109,900,000` shares).

| Metric | Pre-Trade | Post-Trade | Delta |
| :--- | :--- | :--- | :--- |
| **FOR Shares** | `219,800,000` | `109,900,000` | `-109,900,000` |
| **AGAINST Shares** | `200,000,000` | `200,000,000` | `0` |
| **Reserve Balance** | `209,900,000` | `152,367,350` | `-57,532,650` (Payout) |
| **Pulse Index** | `5235` | `3546` | `-1689` BPS |

**Solvency Check (PASS):** `min(F,A) <= R`
`min(109,900,000, 200,000,000) = 109,900,000 <= 152,367,350`

## 4. Position Accounting Verification

The user's internal position ledger within `TradingEngine` was verified post-execution.

- **Final FOR Shares:** `109,900,000`
- **Final AGAINST Shares:** `200,000,000` (from initial liquidity)

Both values perfectly match the expected arithmetic state, proving that position accounting is accurate.

## 5. Conclusion

The on-chain functional validation confirms that the deployed **Pulse V1 Core (be73488)** behaves exactly as defined in the protocol specifications. The CSM math, economic invariants, and position accounting are fully operational and secure on the Sepolia network.

---
*Pulse Protocol Solidity Engineer*
*2026-08-03*
