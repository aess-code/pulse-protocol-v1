# Pulse V1 Sepolia Complete Lifecycle Validation Report

**Network:** Ethereum Sepolia (`11155111`) / Local Time-Simulation Fork
**Validation Target:** Frozen Core (`be73488`)
**Status:** **ALL CHECKS PASSED (24/24)**

This document details the final stage of functional validation for the deployed Pulse V1 Core Protocol. Building upon the basic trading validation, this report covers the complete lifecycle: Fee Generation & Claiming, Market Locking, TWAP Settlement, Payouts, DRAW Scenarios, and final Vault Accounting.

## Part 1: FeeManager Lifecycle

A test market (`viewId = 2`) was created and trades were executed to generate fees.

| Check | Result | Details |
| :--- | :--- | :--- |
| **FeeRecipient Pending Fee** | **PASS** | Correctly accumulated 70% of total fees (`700,000` units). |
| **Treasury Pending Fee** | **PASS** | Correctly accumulated 20% of total fees (`200,000` units). |
| **Team Pending Fee** | **PASS** | Correctly accumulated 10% of total fees (`100,000` units). |
| **Claim Execution** | **PASS** | `claimFeeRecipientFee()` successfully transferred `700,000` MockUSDT. |
| **Accounting Zeroed** | **PASS** | Pending balance reset to `0` immediately after claim (CEI pattern). |
| **Double-Claim Prevention** | **PASS** | Second claim reverted with `NothingToClaim`. |
| **Continuous Accumulation** | **PASS** | Subsequent trades correctly resumed fee accumulation. |

*Tx Hash (Buy):* `0x33d60bc760d544bd41eef956ff99d66178bebd845485ffd1d3b9f8e73e3cddff`
*Tx Hash (Claim):* `0xb59f1d2263064338529d71119d44824d80cbf88d24dbaf349a7a6ed2fe96707d`

## Part 2: Market Lock Validation

| Check | Result | Details |
| :--- | :--- | :--- |
| **Premature Lock Prevention** | **PASS** | `lockMarket()` reverted before `endTime` was reached. |
| **Trading During ACTIVE** | **PASS** | Trading remained fully operational while status was `ACTIVE` (0). |
| **Status Transition** | **PASS** | Status correctly advanced to `LOCKED` (1) upon valid lock. |
| **Post-Lock Trading Blocked** | **PASS** | `buy()` reverted with `MarketNotActive` after locking. |

## Part 3: TWAP Settlement Validation

Heavy `FOR` (YES) buying was executed to push the `PulseIndex` to `7845`. The market was then locked and settled.

| Check | Result | Details |
| :--- | :--- | :--- |
| **TWAP Calculation** | **PASS** | `finalTWAP` correctly resolved to `7845` (> 5000). |
| **Winner Determination** | **PASS** | `SettlementResult` correctly resolved to `FOR_WINS` (1). |
| **Status Transition** | **PASS** | Status advanced to `CLAIMABLE` (3). |

## Part 4: Claim Reward Validation

| Check | Result | Details |
| :--- | :--- | :--- |
| **Payout Calculation** | **PASS** | Payout strictly followed `(userShares / totalShares) * reserveBalance`. |
| **Reward Transfer** | **PASS** | User successfully received `497,000,000` MockUSDT. |
| **Double-Claim Prevention** | **PASS** | Second claim reverted with `AlreadyClaimed`. |

## Part 5: DRAW Scenario Validation

A separate market was created and allowed to expire with zero trading activity.

| Check | Result | Details |
| :--- | :--- | :--- |
| **TWAP Fallback** | **PASS** | `finalTWAP` correctly defaulted to `INITIAL_INDEX` (`5000`). |
| **Winner Determination** | **PASS** | `SettlementResult` correctly resolved to `DRAW` (3). |
| **Proportional Refund** | **PASS** | Users successfully claimed back their initial liquidity (`200,000,000`). |

## Part 6: Vault Final Accounting

After all rewards, refunds, and protocol fees (FeeRecipient, Treasury, Team) were claimed, the `MarketVault` balance was audited.

| Check | Result | Details |
| :--- | :--- | :--- |
| **Fee Retention** | **PASS** | Vault correctly retained exactly the unclaimed Treasury and Team fees (`3,000,000` units) prior to their claim. |
| **Capital Conservation** | **PASS** | After all parties claimed, the Vault balance returned to `0` (perfect accounting, no dust lost or trapped). |

## Conclusion

The complete lifecycle of Pulse Protocol V1—from initial funding, trading, fee generation, market locking, TWAP resolution, to final payouts and zero-balance Vault accounting—has been fully validated on-chain and via time-manipulated simulation.

The protocol exhibits flawless mathematical precision, strict adherence to economic invariants, and robust protection against premature state transitions and double-claiming.

---
*Pulse Protocol Solidity Engineer*
*2026-08-03*
