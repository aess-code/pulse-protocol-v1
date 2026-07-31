# Pulse Protocol V1 Verification Checklist

**Baseline:** Stage 6.5 Security Hardened (`v1.0.0-stage6.5-official`)  
**Purpose:** Unified verification standard for all future testing, bug fixes, and security validation activities.

This checklist defines the minimum verification requirements for Pulse Protocol V1. All items must pass before any change is considered production-ready. Items marked **[COVERED]** have existing test coverage in the current test suite.

---

## 1. Functional Tests

These tests verify the core trading and market creation functionality.

| ID | Test Objective | Expected Result | Related Contract | Rule Source |
| :--- | :--- | :--- | :--- | :--- |
| F-01 | Buy shares on the FOR side with valid inputs. | Shares minted, reserve increases, fee recorded, event emitted. | `TradingEngine.sol` | `docs/Economic_Model_Specification.md` §3 |
| F-02 | Buy shares on the AGAINST side with valid inputs. | Shares minted, reserve increases, fee recorded, event emitted. | `TradingEngine.sol` | `docs/Economic_Model_Specification.md` §3 |
| F-03 | Sell FOR shares with valid inputs. | Shares burned, reserve decreases, fee recorded, tokens returned. | `TradingEngine.sol` | `docs/Economic_Model_Specification.md` §3 |
| F-04 | Sell AGAINST shares with valid inputs. | Shares burned, reserve decreases, fee recorded, tokens returned. | `TradingEngine.sol` | `docs/Economic_Model_Specification.md` §3 |
| F-05 | Create a FIXED View via `PulseFactory`. | ViewRecord stored, Vault deployed, `ViewCreated` event emitted. | `PulseFactory.sol` | `docs/Product_Specification.md` §3 |
| F-06 | Create a PERMANENT View via `PulseFactory`. | ViewRecord stored with `endTime == 0`, Vault deployed. | `PulseFactory.sol` | `docs/Product_Specification.md` §3 |
| F-07 | Buy with `amountIn == 0` must revert. | Reverts with `PriceEngine__ZeroAmount`. | `TradingEngine.sol` | `docs/Protocol_Security_Standard.md` §6 |
| F-08 | Buy with invalid side (> 1) must revert. | Reverts with `PriceEngine__InvalidSide`. | `TradingEngine.sol` | `contracts/pricing/PriceEngine.sol` |
| F-09 | Sell more shares than owned must revert. | Reverts with `TradingEngine__InsufficientShares`. | `TradingEngine.sol` | `contracts/TradingEngine.sol` |
| F-10 | Buy with `minSharesOut` slippage check triggered. | Reverts with `TradingEngine__SlippageExceeded`. | `TradingEngine.sol` | `docs/Stage6_5_Security_Hardened_Report.md` |
| F-11 | Sell with `minAmountOut` slippage check triggered. | Reverts with `TradingEngine__SlippageExceeded`. | `TradingEngine.sol` | `docs/Stage6_5_Security_Hardened_Report.md` |

---

## 2. Market Lifecycle Tests (FIXED Market)

These tests verify the state machine transitions for FIXED markets.

| ID | Test Objective | Expected Result | Related Contract | Rule Source |
| :--- | :--- | :--- | :--- | :--- |
| L-01 | Lock a FIXED market after `endTime` is reached. | Status transitions to `LOCKED`, TWAP finalized, events emitted. | `TradingEngine.sol` | `docs/Protocol_Specification.md` §8 |
| L-02 | Attempt to lock a market before `endTime`. | Reverts with `TradingEngine__EndTimeNotReached`. | `TradingEngine.sol` | `docs/Protocol_Specification.md` §8 |
| L-03 | Attempt to buy in a `LOCKED` market. | Reverts with `TradingEngine__MarketNotActive`. | `TradingEngine.sol` | `docs/Protocol_Specification.md` §8 |
| L-04 | Settle a `LOCKED` market. | Status transitions to `CLAIMABLE`, result stored. | `SettlementManager.sol` | `docs/Protocol_Specification.md` §7 |
| L-05 | Attempt to settle a non-`LOCKED` market. | Reverts with `Settlement__MarketNotLocked`. | `SettlementManager.sol` | `docs/Protocol_Specification.md` §7 |
| L-06 | Attempt to double-settle a market. | Reverts with `Settlement__AlreadySettled`. | `SettlementManager.sol` | `docs/Protocol_Specification.md` §7 |
| L-07 | Claim reward in a `CLAIMABLE` market. | Tokens transferred to winner, position marked as claimed. | `SettlementManager.sol` | `docs/Product_Specification.md` §6 |
| L-08 | Attempt to double-claim a reward. | Reverts with `Settlement__AlreadyClaimed`. | `SettlementManager.sol` | `docs/Product_Specification.md` §6 |
| L-09 | Attempt to claim with no position. | Reverts with `Settlement__NoPositionToClaim`. | `SettlementManager.sol` | `docs/Product_Specification.md` §6 |
| L-10 | Illegal state transition: ACTIVE → SETTLEMENT (skip LOCKED). | Reverts. | `TradingEngine.sol` | `docs/Protocol_Specification.md` §8 |

---

## 3. Permanent Market Tests

These tests verify the specific behavior of PERMANENT markets.

| ID | Test Objective | Expected Result | Related Contract | Rule Source |
| :--- | :--- | :--- | :--- | :--- |
| P-01 | Attempt to lock a PERMANENT market. | Reverts with `TradingEngine__InvalidStatus`. | `TradingEngine.sol` | `docs/Protocol_Constitution.md` §4 |
| P-02 | Buy and sell in a PERMANENT market. | Succeeds. Market remains in `ACTIVE` state. | `TradingEngine.sol` | `docs/Protocol_Constitution.md` §4 |
| P-03 | Verify PERMANENT market `endTime` is `0`. | `ViewRecord.endTime == 0`. | `PulseFactory.sol` | `contracts/interfaces/IPulseFactory.sol` |
| P-04 | Attempt to settle a PERMANENT market. | Reverts (market is never `LOCKED`). | `SettlementManager.sol` | `docs/Protocol_Constitution.md` §4 |

---

## 4. Settlement Tests

These tests verify the settlement outcome determination.

| ID | Test Objective | Expected Result | Related Contract | Rule Source |
| :--- | :--- | :--- | :--- | :--- |
| S-01 | Settle a market with TWAP > 5000. | Result is `FOR_WINS`. FOR shareholders receive payout. | `SettlementManager.sol` | `docs/Economic_Model_Specification.md` §4 |
| S-02 | Settle a market with TWAP < 5000. | Result is `AGAINST_WINS`. AGAINST shareholders receive payout. | `SettlementManager.sol` | `docs/Economic_Model_Specification.md` §4 |
| S-03 | Settle a market with TWAP == 5000. | Result is `DRAW`. All shareholders receive proportional refund. | `SettlementManager.sol` | `docs/Economic_Model_Specification.md` §4 |
| S-04 | Verify payout formula for FOR_WINS: `payout = (userForShares / totalForSupply) * totalReserve`. | Payout matches formula. | `SettlementManager.sol` | `docs/Economic_Model_Specification.md` §4 |
| S-05 | Verify payout formula for DRAW: `payout = (userTotalShares / totalSupply) * totalReserve`. | Payout matches formula. | `SettlementManager.sol` | `docs/Economic_Model_Specification.md` §4 |
| S-06 | Verify total payouts do not exceed `totalReserve`. | Sum of all claims <= `reserveBalance`. | `SettlementManager.sol` | `docs/Protocol_Constitution.md` §3 |

---

## 5. TWAP Boundary Tests

These tests verify the TWAP calculation edge cases.

| ID | Test Objective | Expected Result | Related Contract | Rule Source |
| :--- | :--- | :--- | :--- | :--- |
| T-01 | Zero snapshots in settlement window, market had prior activity. | TWAP uses `lastIndexBeforeWindow`. | `TWAPLibrary.sol` | `contracts/libraries/TWAPLibrary.sol` |
| T-02 | Zero snapshots, market had zero activity ever. | TWAP defaults to `INITIAL_INDEX` (5000). | `TWAPLibrary.sol` | `contracts/libraries/TWAPLibrary.sol` |
| T-03 | Multiple snapshots in settlement window. | TWAP is the time-weighted average. | `TWAPLibrary.sol` | `docs/Economic_Model_Specification.md` §4 |
| T-04 | Attempt to record snapshot outside the 30-minute settlement window. | Snapshot is silently skipped (no revert). | `TWAPLibrary.sol` | `contracts/libraries/TWAPLibrary.sol` |
| T-05 | Attempt to record snapshot before 60 seconds have elapsed. | Snapshot is silently skipped. | `TWAPLibrary.sol` | `contracts/libraries/TWAPLibrary.sol` |
| T-06 | Attempt to record more than 30 snapshots. | 31st snapshot is silently skipped. | `TWAPLibrary.sol` | `contracts/libraries/TWAPLibrary.sol` |

---

## 6. Economic Formula Tests

These tests verify the mathematical correctness of the pricing engine.

| ID | Test Objective | Expected Result | Related Contract | Rule Source |
| :--- | :--- | :--- | :--- | :--- |
| E-01 | Verify Pulse Index formula: `floor(forSupply * 10000 / total)`. | Index matches formula. | `MathLibrary.sol` | `docs/Economic_Model_Specification.md` §2 |
| E-02 | Verify Pulse Index is clamped to `[1, 9999]`. | Index never equals 0 or 10000. | `MathLibrary.sol` | `docs/Protocol_Security_Standard.md` §4 |
| E-03 | Verify buy formula: `sharesOut = floor(amountIn * 10000 / sidePrice_bps)`. | Shares match formula. | `PriceEngine.sol` | `docs/Economic_Model_Specification.md` §3 |
| E-04 | Verify sell formula: `amountOut = floor(sharesIn * sidePrice_bps / 10000)`. | Amount matches formula. | `PriceEngine.sol` | `docs/Economic_Model_Specification.md` §3 |
| E-05 | Verify solvency invariant: `min(forSupply, againstSupply) <= reserveBalance` after every trade. | Invariant holds. | `PriceEngine.sol` | `docs/Protocol_Constitution.md` §3 |
| E-06 | Buy with maximum `uint256` input without overflow. | Succeeds or reverts cleanly (no panic). | `PriceEngine.sol` | `docs/Protocol_Security_Standard.md` §5 |
| E-07 | Verify `mulDiv` is used for all critical arithmetic (no direct `a * b / c`). | No overflow in intermediate calculations. | `MathLibrary.sol` | `docs/Protocol_Security_Standard.md` §5 |

---

## 7. Fee Tests

These tests verify the fee accounting and distribution model.

| ID | Test Objective | Expected Result | Related Contract | Rule Source |
| :--- | :--- | :--- | :--- | :--- |
| FE-01 | Verify fee is 1.00% of gross trade amount. | `feeAmount == floor(grossAmount * 100 / 10000)`. | `TradingEngine.sol`, `FeeManager.sol` | `docs/Economic_Model_Specification.md` §6 |
| FE-02 | Verify fee split: Creator 50%, Treasury 30%, Team 20%. | Ledger entries match split. | `FeeManager.sol` | `docs/Economic_Model_Specification.md` §6 |
| FE-03 | Verify `totalFeesRecorded` in Vault equals sum of all recorded fees. | `Vault.totalFeesRecorded` matches. | `MarketVault.sol` | `docs/Stage5_Core_Completion_Report.md` §2 |
| FE-04 | Verify Creator can claim their fee. | Tokens transferred, ledger zeroed. | `FeeManager.sol` | `docs/Product_Specification.md` §7 |
| FE-05 | Verify Treasury can claim their fee. | Tokens transferred, ledger zeroed. | `FeeManager.sol` | `docs/Product_Specification.md` §7 |
| FE-06 | Verify Team can claim their fee. | Tokens transferred, ledger zeroed. | `FeeManager.sol` | `docs/Product_Specification.md` §7 |
| FE-07 | Attempt to over-release fees beyond `totalFeesRecorded`. | Reverts with `Vault__FeeExceedsRecorded`. | `MarketVault.sol` | `docs/Stage5_Core_Completion_Report.md` §2 |
| FE-08 | Unauthorized address attempts to call `claimCreatorFee`. | Reverts with `FeeManager__UnauthorisedCaller`. | `FeeManager.sol` | `docs/Protocol_Security_Standard.md` §1 |

---

## 8. Security Boundary Tests

These tests verify defensive checks and attack resistance.

| ID | Test Objective | Expected Result | Related Contract | Rule Source |
| :--- | :--- | :--- | :--- | :--- |
| SB-01 | Verify `PriceEngine` output validation: `sharesOut == 0` triggers revert. | Reverts with `TradingEngine__InvalidPriceEngineOutput`. | `TradingEngine.sol` | `docs/Stage5_Core_Completion_Report.md` §4 |
| SB-02 | Verify `PriceEngine` output validation: `newPulseIndex == 0` triggers revert. | Reverts with `TradingEngine__InvalidPulseIndex`. | `TradingEngine.sol` | `docs/Protocol_Security_Standard.md` §4 |
| SB-03 | Verify `PriceEngine` output validation: reserve decreases on buy triggers revert. | Reverts with `TradingEngine__InvalidReserveBalance`. | `TradingEngine.sol` | `docs/Stage5_Core_Completion_Report.md` §4 |
| SB-04 | Verify `ReentrancyGuard` prevents reentrancy on `buy`. | Reentrancy attempt reverts. | `TradingEngine.sol` | `docs/Protocol_Security_Standard.md` §2 |
| SB-05 | Verify `ReentrancyGuard` prevents reentrancy on `claimReward`. | Reentrancy attempt reverts. | `SettlementManager.sol` | `docs/Protocol_Security_Standard.md` §2 |
| SB-06 | Verify `ReentrancyGuard` prevents reentrancy on `releaseFee`. | Reentrancy attempt reverts. | `MarketVault.sol` | `docs/Protocol_Security_Standard.md` §2 |
| SB-07 | Verify Vault capital conservation invariant holds after all operations. | `balance() + withdrawals + settled + feesReleased >= deposits`. | `MarketVault.sol` | `docs/Protocol_Constitution.md` §3 |
| SB-08 | Verify CEI pattern: state is updated before external calls in all claim functions. | State is zeroed before `releaseFee` is called. | `FeeManager.sol` | `docs/Protocol_Security_Standard.md` §2 |

---

## 9. Access Control Tests

These tests verify that all permission boundaries are enforced.

| ID | Test Objective | Expected Result | Related Contract | Rule Source |
| :--- | :--- | :--- | :--- | :--- |
| AC-01 | Non-TradingEngine calls `MarketVault.deposit`. | Reverts with `Vault__UnauthorisedEngine`. | `MarketVault.sol` | `docs/Protocol_Security_Standard.md` §1 |
| AC-02 | Non-TradingEngine calls `MarketVault.withdraw`. | Reverts with `Vault__UnauthorisedEngine`. | `MarketVault.sol` | `docs/Protocol_Security_Standard.md` §1 |
| AC-03 | Non-SettlementManager calls `MarketVault.settle`. | Reverts with `Vault__UnauthorisedSettlement`. | `MarketVault.sol` | `docs/Protocol_Security_Standard.md` §1 |
| AC-04 | Non-FeeManager calls `MarketVault.releaseFee`. | Reverts with `Vault__UnauthorisedFeeManager`. | `MarketVault.sol` | `docs/Protocol_Security_Standard.md` §1 |
| AC-05 | Non-FeeManager calls `MarketVault.notifyFeeRecorded`. | Reverts with `Vault__UnauthorisedFeeManager`. | `MarketVault.sol` | `docs/Protocol_Security_Standard.md` §1 |
| AC-06 | Non-TradingEngine calls `FeeManager.recordFee`. | Reverts with `FeeManager__UnauthorisedCaller`. | `FeeManager.sol` | `docs/Protocol_Security_Standard.md` §1 |
| AC-07 | Non-SettlementManager calls `TradingEngine.setStatusSettlement`. | Reverts. | `TradingEngine.sol` | `docs/Protocol_Specification.md` §8 |
| AC-08 | Non-SettlementManager calls `TradingEngine.setStatusClaimable`. | Reverts. | `TradingEngine.sol` | `docs/Protocol_Specification.md` §8 |
| AC-09 | Non-SettlementManager calls `TradingEngine.markPositionClaimed`. | Reverts. | `TradingEngine.sol` | `docs/Protocol_Specification.md` §7 |

---

## 10. Regression Tests

These tests must be re-run after any change to verify no regressions are introduced.

| ID | Test Objective | Expected Result | Related Test File | Rule Source |
| :--- | :--- | :--- | :--- | :--- |
| R-01 | Full lifecycle: create → buy → sell → lock → settle → claim. | All steps succeed, final state is consistent. | `Stage5Integration.test.cjs` | `docs/Protocol_Specification.md` |
| R-02 | Multi-user buy/sell sequence with invariant check after each trade. | All 6 invariants hold throughout. | `TradingEngineInvariant.test.cjs` | `docs/Protocol_Constitution.md` §3 |
| R-03 | Fee accounting: buy → recordFee → notifyFeeRecorded → claim. | Fee is correctly recorded and claimed. | `FeeVaultIntegration.test.cjs` | `docs/Product_Specification.md` §7 |
| R-04 | Security regression: Factory Deployment DoS fix. | `PulseFactory.createView` succeeds without reverting. | `Stage6_5_Security.test.cjs` | `docs/Stage6_5_Security_Hardened_Report.md` |
| R-05 | Security regression: Slippage protection. | `buy` and `sell` revert when slippage is exceeded. | `Stage6_5_Security.test.cjs` | `docs/Stage6_5_Security_Hardened_Report.md` |
| R-06 | Security regression: PERMANENT market lock rejection. | `lockMarket` reverts for PERMANENT markets. | `Stage6_5_Security.test.cjs` | `docs/Stage6_5_Security_Hardened_Report.md` |
| R-07 | All existing tests pass with zero failures. | 92/92 tests pass. | All test files | `docs/V1_Final_Freeze_Declaration.md` |
