# Stage 7 — Part 3, 4 & 5 Security Review Matrix
## Complete Security Audit + Protocol Consistency Review + Architecture Freeze Verification

**Audit Date:** 2026-07-31  
**Baseline:** `v1.0.0-stage6.6-frozen` (commit `91fd130`)  

---

## Part 3: Complete Security Audit

### Security Review Matrix

| # | Issue | Severity | Contract | Status | Action |
|---|---|---|---|---|---|
| S-01 | **Reentrancy: `buy()`** | Critical | `TradingEngine` | ✅ NOT PRESENT | `nonReentrant` modifier applied. CEI pattern enforced: state updates before `safeTransferFrom` and `deposit()`. |
| S-02 | **Reentrancy: `sell()`** | Critical | `TradingEngine` | ✅ NOT PRESENT | `nonReentrant` modifier applied. CEI pattern enforced: state updates before `withdraw()`. |
| S-03 | **Reentrancy: `lockMarket()`** | Critical | `TradingEngine` | ✅ NOT PRESENT | `nonReentrant` modifier applied. |
| S-04 | **Reentrancy: `claimReward()`** | Critical | `SettlementManager` | ✅ NOT PRESENT | CEI pattern: `markPositionClaimed()` called before `Vault.settle()`. No `nonReentrant` on `SettlementManager`, but the CEI pattern prevents double-claim. Vault's `settle()` has `nonReentrant`. |
| S-05 | **Reentrancy: `claimCreatorFee()`** | Critical | `FeeManager` | ✅ NOT PRESENT | CEI pattern: ledger zeroed before `releaseFee()`. Vault's `releaseFee()` has `nonReentrant`. |
| S-06 | **Reentrancy: `claimTreasuryFee()` / `claimTeamFee()`** | Critical | `FeeManager` | ✅ NOT PRESENT | Same CEI pattern as `claimCreatorFee()`. |
| S-07 | **Access Control: `setStatusSettlement()`** | High | `TradingEngine` | ✅ NOT PRESENT | `_requireAuthorisedSettlement()` checks `msg.sender == factory.getView(viewId).settlementManager`. |
| S-08 | **Access Control: `setStatusClaimable()`** | High | `TradingEngine` | ✅ NOT PRESENT | Same guard as S-07. |
| S-09 | **Access Control: `markPositionClaimed()`** | High | `TradingEngine` | ✅ NOT PRESENT | Same guard as S-07. |
| S-10 | **Access Control: `Vault.deposit()`** | High | `MarketVault` | ✅ NOT PRESENT | `onlyTradingEngine` modifier. |
| S-11 | **Access Control: `Vault.withdraw()`** | High | `MarketVault` | ✅ NOT PRESENT | `onlyTradingEngine` modifier. |
| S-12 | **Access Control: `Vault.settle()`** | High | `MarketVault` | ✅ NOT PRESENT | `onlySettlementManager` modifier. |
| S-13 | **Access Control: `Vault.releaseFee()`** | High | `MarketVault` | ✅ NOT PRESENT | `onlyFeeManager` modifier. |
| S-14 | **Access Control: `Vault.setFeeManager()`** | High | `MarketVault` | ✅ NOT PRESENT | Only callable by `authorizedTradingEngine` OR `factory`. Can only be called once. |
| S-15 | **Access Control: `VaultFactory.deployVault()`** | High | `MarketVaultFactory` | ✅ NOT PRESENT | `onlyAuthorizedFactory` modifier. |
| S-16 | **Initialization: Vault FeeManager not set** | High | `MarketVault` | ✅ NOT PRESENT | `PulseFactory.createView()` calls `setFeeManager()` atomically in the same transaction as Vault deployment. |
| S-17 | **Storage Collision** | High | All | ✅ NOT PRESENT | No proxy patterns used. All contracts are non-upgradeable. No storage collision risk. |
| S-18 | **Arithmetic Overflow/Underflow** | High | All | ✅ NOT PRESENT | Solidity 0.8.x checked arithmetic. `MathLibrary.mulDiv()` uses 512-bit assembly with explicit overflow check. |
| S-19 | **`SettlementManager` lacks `nonReentrant`** | Medium | `SettlementManager` | ⚠️ NOTED | `settleMarket()` and `claimReward()` lack `nonReentrant`. However: (1) `settleMarket()` has no external calls to untrusted contracts — `setStatusSettlement/Claimable` are state updates only; (2) `claimReward()` uses strict CEI — `markPositionClaimed()` before `Vault.settle()`. The Vault's `settle()` itself is `nonReentrant`. **Risk: LOW** — CEI prevents double-claim. Adding `nonReentrant` to `SettlementManager` would be a defense-in-depth improvement. |
| S-20 | **`FeeManager` lacks `nonReentrant`** | Medium | `FeeManager` | ⚠️ NOTED | `claimCreatorFee/TreasuryFee/TeamFee` lack `nonReentrant`. CEI pattern (ledger zeroed before `releaseFee()`) prevents double-claim. Vault's `releaseFee()` is `nonReentrant`. **Risk: LOW** — CEI is sufficient. Adding `nonReentrant` would be defense-in-depth. |
| S-21 | **`PulseFactory.createView()` lacks `nonReentrant`** | Low | `PulseFactory` | ⚠️ NOTED | `createView()` deploys a new Vault contract. The `viewId` counter increments before Vault deployment, preventing duplicate viewId registration. Reentrancy would create a new Vault with a different viewId. **Risk: NEGLIGIBLE** — no economic harm possible. |
| S-22 | **DoS: `finaliseTWAP()` gas limit** | Medium | `TWAPLibrary` | ⚠️ NOTED | `finaliseTWAP()` iterates up to 240 slots. Estimated gas: ~50,000–80,000 (within block gas limit). Measured in Part 7. |
| S-23 | **Front-running: `lockMarket()`** | Low | `TradingEngine` | ✅ MITIGATED | Dual-Anchor Blockhash design prevents `lockMarket()` caller from controlling `T_stop`. Stage 6.6 security test G confirms this. |
| S-24 | **MEV Sandwich on `buy()`** | Low | `TradingEngine` | ✅ MITIGATED | `minSharesOut` slippage protection added in Stage 6.5. Users can set their own slippage tolerance. |
| S-25 | **MEV Sandwich on `sell()`** | Low | `TradingEngine` | ✅ MITIGATED | `minAmountOut` slippage protection added in Stage 6.5. |
| S-26 | **Tail Manipulation (TWAP)** | Medium | `TWAPLibrary` | ✅ MITIGATED | Stage 6.6 random T_stop prevents deterministic tail manipulation. Security test D confirms this. |
| S-27 | **Replay Attack** | Low | All | ✅ NOT PRESENT | No signature-based operations. No replay surface. |
| S-28 | **State Pollution: PERMANENT market** | High | `TradingEngine` | ✅ NOT PRESENT | PERMANENT markets cannot enter LOCKED/SETTLEMENT/CLAIMABLE. Confirmed in Part 1. |
| S-29 | **External Call: `PriceEngine` output validation** | Medium | `TradingEngine` | ✅ NOT PRESENT | Defensive checks on `sharesOut`, `newPulseIndex`, `newReserveBalance` added in Stage 6.5 (Fix ③④⑤). |
| S-30 | **Callback: ERC20 `safeTransferFrom`** | Medium | `TradingEngine` | ✅ MITIGATED | Uses OpenZeppelin `SafeERC20`. State updates occur before the transfer (CEI). `nonReentrant` prevents reentrant calls. |
| S-31 | **Ownership: No admin key** | Informational | All | ✅ INTENTIONAL | V1 has no admin/owner. All authorization is role-based and immutable. This is a design choice, not a vulnerability. |
| S-32 | **Gas Limit: `claimReward()` with large position** | Low | `SettlementManager` | ✅ NOT PRESENT | `_calculatePayout()` uses only `mulDiv()` — O(1) gas. No loops. |
| S-33 | **Vault `_assertInvariant()` gas cost** | Low | `MarketVault` | ✅ ACCEPTABLE | Called after every state-changing Vault operation. Single comparison. Negligible gas cost. |

---

### Critical/High Issues Summary

**No Critical or High severity issues found.**

All Critical and High items are either NOT PRESENT or have been addressed in previous stages.

---

### Medium Issues Requiring Attention

| Issue | Recommendation | Priority |
|---|---|---|
| S-19: `SettlementManager` lacks `nonReentrant` | Add `nonReentrant` to `settleMarket()` and `claimReward()` as defense-in-depth | Medium |
| S-20: `FeeManager` lacks `nonReentrant` | Add `nonReentrant` to all three `claim*Fee()` functions | Medium |
| S-22: `finaliseTWAP()` gas benchmark needed | Measure and document gas cost with 240 slots | Medium |

---

## Part 4: Protocol Consistency Review

### One Protocol, Shared Architecture, Minimal Branch

**Finding: PASS**

The protocol correctly implements the "One Protocol, Shared Architecture" principle:

| Component | FIXED Market | PERMANENT Market | Shared? |
|---|---|---|---|
| `TradingEngine` | ✅ | ✅ | **YES** |
| `PriceEngine` | ✅ | ✅ | **YES** |
| `MarketVault` | ✅ | ✅ | **YES** |
| `FeeManager` | ✅ | ✅ | **YES** |
| `PulseFactory` | ✅ | ✅ | **YES** |
| Liquidity | ✅ | ✅ | **YES** |
| Index | ✅ | ✅ | **YES** |
| TWAP Snapshot | ✅ | No-op (endTime=0) | **SHARED CODE PATH** |
| Accounting | ✅ | ✅ | **YES** |

### Branch Analysis

The only `if(PERMANENT)` equivalent branch in the codebase:

1. `TradingEngine.lockMarket()` line 294: `if (viewType == PERMANENT) revert` — **necessary lifecycle protection, not a bypass**
2. `TWAPLibrary.recordSlotState()` line 152: `if (endTime == 0) return` — **necessary no-op for PERMANENT markets, not a bypass**
3. `PulseFactory.createView()` lines 152-157: time validation differs for FIXED vs PERMANENT — **necessary validation, not duplicate logic**

**Total branches: 3. All are necessary and minimal.**

**No duplicate implementations found** for Trading, Fee, Vault, or Accounting logic.

**Verdict: PASS.** Architecture is minimal and shared. No branching that causes architectural split.

---

## Part 5: Architecture Freeze Verification

### Module Responsibility Verification

| Module | Declared Responsibility | Actual Implementation | Drift? |
|---|---|---|---|
| **TradingEngine** | Trade orchestration, position accounting, lifecycle management | `buy()`, `sell()`, `lockMarket()`, `setStatus*()`, `markPositionClaimed()` — no financial calculation | ✅ NO DRIFT |
| **PriceEngine** | Stateless price calculation | `quoteBuy()`, `quoteSell()`, `currentIndex()` — pure functions, zero storage | ✅ NO DRIFT |
| **TWAPLibrary** | Settlement observation algorithm | `recordSlotState()`, `finaliseTWAP()` — no external calls, no asset movement | ✅ NO DRIFT |
| **FeeManager** | Fee accounting only | `recordFee()`, `claim*Fee()` — no direct token custody, delegates to Vault | ✅ NO DRIFT |
| **MarketVault** | Asset custody | `deposit()`, `withdraw()`, `settle()`, `releaseFee()` — no business logic | ✅ NO DRIFT |
| **SettlementManager** | Settlement execution | `settleMarket()`, `claimReward()` — reads TWAP, determines result, delegates to Vault | ✅ NO DRIFT |
| **PulseFactory** | View creation and registry | `createView()`, `getView()`, `getVault()` — no trading logic | ✅ NO DRIFT |

### SSOT Compliance

All modules comply with:
- `docs/Protocol_Constitution.md`
- `docs/Protocol_Specification.md`
- `docs/Protocol_Security_Standard.md`
- `docs/V1_Protocol_Freeze_Declaration.md`

**Verdict: PASS. No responsibility drift detected.**

---

*Part 3-5 audit complete. Two Medium issues identified (S-19, S-20) requiring `nonReentrant` addition.*  
*No Critical or High issues found.*
