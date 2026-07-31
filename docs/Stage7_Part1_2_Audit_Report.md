# Stage 7 — Part 1 & 2 Audit Report
## Permanent Market Security Audit + Fixed Market Settlement Audit

**Audit Date:** 2026-07-31  
**Baseline:** `v1.0.0-stage6.6-frozen` (commit `91fd130`)  
**Auditor:** Manus Protocol Engineer (Independent Review Mode)  

---

## Part 1: Permanent Market Security Audit

### 1.1 Lifecycle Protection

**Finding: PASS**

`lockMarket()` in `TradingEngine.sol` (line 294) explicitly checks:
```solidity
if (viewType == IPulseFactory.ViewType.PERMANENT) {
    revert TradingEngine__InvalidStatus(viewId, state.status);
}
```
A PERMANENT market cannot be locked by `lockMarket()`. This is the primary lifecycle protection gate.

**Downstream protection chain:**
- `setStatusSettlement()` requires `status == LOCKED` → PERMANENT markets are always `ACTIVE`, never `LOCKED` → **protected**
- `setStatusClaimable()` requires `status == SETTLEMENT` → **protected**
- `markPositionClaimed()` requires SettlementManager authorization → SettlementManager can never reach this for PERMANENT markets → **protected**
- `settleMarket()` in `SettlementManager.sol` requires `status == LOCKED` → **protected**
- `claimReward()` in `SettlementManager.sol` requires `status == CLAIMABLE` → **protected**

**Verdict:** PERMANENT market lifecycle is fully protected through the state machine. No function can advance a PERMANENT market beyond `ACTIVE`.

---

### 1.2 TradingEngine — PERMANENT Market Trading

**Finding: PASS**

`buy()` and `sell()` only check `_requireStatus(viewId, MarketStatus.ACTIVE)`. Since PERMANENT markets are always `ACTIVE`, they can:
- ✅ `buy()`
- ✅ `sell()`
- ✅ Update Pulse Index
- ✅ Record TWAP slot state (via `recordSlotState()`)
- ✅ Generate analytics data

**No `if(PERMANENT) return;` bypass logic exists.** PERMANENT markets participate fully in the trading layer.

**Note on TWAP for PERMANENT markets:** `recordSlotState()` in `TWAPLibrary.sol` (line 152) checks:
```solidity
if (endTime == 0) return;
```
Since PERMANENT markets have `endTime == 0`, `recordSlotState()` is a no-op for them. This is correct by design — PERMANENT markets do not have a settlement observation window. They still update `lastPulseIndex` and `lastTradeTimestamp` in `TradingEngine`, which can be used for analytics.

**Verdict:** PASS. No bypass logic. Trading works correctly for PERMANENT markets.

---

### 1.3 Settlement Isolation

**Finding: PASS**

`SettlementManager.settleMarket()` requires `status == LOCKED`. PERMANENT markets are always `ACTIVE`. The settlement path is completely isolated.

`SettlementManager.claimReward()` requires `status == CLAIMABLE`. Impossible for PERMANENT markets.

**Data Layer preservation:** PERMANENT markets retain:
- `lastPulseIndex` (updated on every trade)
- `lastTradeTimestamp`
- `forSupply`, `againstSupply`, `reserveBalance`
- Position data per user

These are accessible via `TradingEngine` view functions and constitute the Data Layer. They are not affected by the Settlement isolation.

**Verdict:** PASS. Settlement is fully isolated from PERMANENT markets.

---

### 1.4 Permanent Market Invariant

**Established Invariant:**
```
PERMANENT market: status == ACTIVE forever
∀ viewId where ViewType == PERMANENT:
  marketStates[viewId].status == ACTIVE at all times
```

This invariant is enforced by:
1. `lockMarket()` revert on PERMANENT
2. `setStatusSettlement()` requires LOCKED
3. `setStatusClaimable()` requires SETTLEMENT

**No code path exists that can advance a PERMANENT market's status.**

---

### 1.5 Issues Found

| Issue | Severity | Location | Description |
|---|---|---|---|
| TWAP data unavailable for PERMANENT markets | Informational | `TWAPLibrary.recordSlotState()` | By design: `endTime == 0` causes early return. PERMANENT markets do not generate TWAP data. This is correct per protocol spec. |
| No `PERMANENT` market test in existing suite | Low | `test/` | No dedicated test verifies PERMANENT market trading + lifecycle protection together. Addressed in Part 7. |

---

## Part 2: Fixed Market Settlement Audit

### 2.1 Stage 6.6 TWAP Compliance

**Finding: PASS**

`TWAPLibrary.sol` implements the Stage 6.6 Dynamic Fixed-Slot Random-Cutoff Discrete TWAP as specified in `docs/Stage6_6_Dynamic_TWAP_Design_Specification.md` (Revision 8).

Verified:
- ✅ 60-minute observation window (`OBSERVATION_WINDOW = 60 minutes`)
- ✅ Phase 1: 45 minutes, 180 slots (`PHASE1_DURATION = 45 minutes`)
- ✅ Phase 2: 15 minutes, 60 slots (`PHASE2_DURATION = 15 minutes`)
- ✅ Slot duration: 15 seconds (`SLOT_DURATION = 15`)
- ✅ Total slots: 240 (`TOTAL_SLOTS = 240`)

### 2.2 Slot Rules

**Finding: PASS**

`recordSlotState()` uses `slotIndex = (ts - windowStart) / SLOT_DURATION` — time-defined, not trade-triggered.

Multiple trades in the same slot overwrite the same `packedSlots` entry (last write wins). This correctly implements "only the last valid Index per slot counts."

### 2.3 Fill-Forward

**Finding: PASS**

`finaliseTWAP()` iterates all valid slots. For each slot, it checks `writtenSlotBitmap`. If the bit is not set, it uses `lastFillValue` (the most recent written slot value, initialized to `lastKnownPulseIndex`). This correctly implements Fill-Forward without using future state.

**Critical check:** The reconstruction loop processes slots in ascending order (0 → N). `lastFillValue` is only updated when a slot has been written. This ensures historical slots cannot be contaminated by future state.

### 2.4 Settlement Formula

**Finding: PASS**

```solidity
finalIndex = sum(valid slot values) / count(valid slots)
```
Implemented in `finaliseTWAP()` using integer division. This is the discrete equal-weight arithmetic mean as specified.

### 2.5 Winner Rules

**Finding: PASS**

`SettlementManager.settleMarket()` implements:
```solidity
if (finalTWAP > DRAW_INDEX)      result = FOR_WINS;
else if (finalTWAP < DRAW_INDEX) result = AGAINST_WINS;
else                             result = DRAW;
```
Where `DRAW_INDEX = 5000`. This matches the frozen protocol rule: `>5000 FOR_WINS`, `<5000 AGAINST_WINS`, `=5000 DRAW`.

### 2.6 Consistency Check

| Component | Consistent with Stage 6.6? | Notes |
|---|---|---|
| `SettlementManager` | ✅ YES | Reads `getFinalTWAP()`, applies correct winner rules |
| `TradingEngine.lockMarket()` | ✅ YES | Calls `finaliseTWAP(endTime, viewId)` atomically |
| `TWAPLibrary` | ✅ YES | Implements Revision 8 specification |
| Storage layout | ✅ YES | Packed uint16 slots, single bitmap |
| Gas | ✅ ACCEPTABLE | ~20 storage words for TWAP state |
| Lifecycle | ✅ YES | LOCKED state gates settlement |

### 2.7 Issues Found

| Issue | Severity | Location | Description |
|---|---|---|---|
| `finaliseTWAP` is idempotent but `lockMarket` checks `status == ACTIVE` | Informational | `TradingEngine.lockMarket()` | The status check in `lockMarket()` prevents double-lock at the TradingEngine level. The `TWAPLibrary.finaliseTWAP()` also has its own `locked` flag as a secondary guard. Double protection is correct. |
| No gas benchmark for `finaliseTWAP` with 240 slots | Low | `TWAPLibrary.finaliseTWAP()` | The loop iterates up to 240 slots. Worst case gas should be measured. Addressed in Part 8. |

---

## Compatibility Report

**Stage 6.6 TWAP is fully compatible with the V1 Settlement Architecture.**

No interface changes are required. No economic rule changes were introduced. The Settlement Observation Algorithm replacement is transparent to all callers of `getFinalTWAP()`.

**PERMANENT market compatibility:** Stage 6.6 TWAP changes have zero impact on PERMANENT markets. The `endTime == 0` early return in `recordSlotState()` ensures complete isolation.

---

*No code changes required from Part 1 or Part 2 audit.*  
*All findings are either PASS, Informational, or Low severity.*
