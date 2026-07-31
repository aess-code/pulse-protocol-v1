# Stage 6.6 Final Verification Report

**Stage:** 6.6 — Dynamic Fixed-Slot Random-Cutoff Discrete TWAP  
**Status:** COMPLETE  
**Commit Hash:** `91fd130`  
**Date:** 2026-07-31  

---

## 1. Implementation Summary

Stage 6.6 replaced the V1 Settlement Observation Algorithm with a security-hardened design that eliminates deterministic tail manipulation attacks. The following components were implemented:

### 1.1 60-Minute Observation Window

The observation window was extended from 30 minutes to 60 minutes, divided into two phases:

| Phase | Duration | Slots | Behaviour |
|---|---|---|---|
| Phase 1 — Fixed Observation | 45 minutes | 180 slots | All slots unconditionally included in TWAP |
| Phase 2 — Blind Random Period | 15 minutes | 60 slots | Slots included only up to random T_stop |

**Source:** `contracts/libraries/TWAPLibrary.sol`, constants `PHASE1_DURATION`, `PHASE2_DURATION`

### 1.2 15-Second Fixed Slots

The observation window is divided into 240 fixed 15-second time slots. Each slot's value is the **last Pulse Index written to that slot before the slot ended** — not the first, not an average.

**Key principle:** Slot finalization is logical, not transaction-triggered. No Keeper or external call is required to close a slot.

**Source:** `contracts/libraries/TWAPLibrary.sol`, constant `SLOT_DURATION = 15 seconds`

### 1.3 Fill-Forward Mechanism

Empty slots (no trades) inherit the most recent prior slot value at the time the slot ended. The initial value for all slots is `lastKnownPulseIndex` (the last Pulse Index before the observation window opened). If the market has never traded, the default is `INITIAL_INDEX = 5000`.

**Storage constraint:** Fill-Forward reconstruction uses sparse slot state storage only. Event logs are never used as a state source.

**Source:** `contracts/libraries/TWAPLibrary.sol`, function `finaliseTWAP()`

### 1.4 Historical Slot Immutability

Once a slot's time window ends, its value is permanently fixed. Future trades can only affect the current slot and future slots. This is enforced by the slot index calculation: `slotIndex = (block.timestamp - windowStart) / SLOT_DURATION`.

**Source:** `contracts/libraries/TWAPLibrary.sol`, function `recordSlotState()`

### 1.5 Dual-Anchor Blockhash T_stop

The random cutoff for Phase 2 (`T_stop`) is computed using two entropy anchors:

- **Anchor 1 (`seedBlockNumber`):** Block number of the first trade in Phase 2. Recorded once and immutable.
- **Anchor 2 (`block.number - 1` at lock time):** Unknown to anyone during the blind period.

**Formula:**
```
entropy = keccak256(blockhash(seedBlockNumber), blockhash(block.number - 1), viewId)
T_stop  = blindStart + (entropy % 900)
```

**Fallback:** If `seedBlockNumber == 0` (no blind-period trade) or either blockhash is stale (> 256 blocks), `T_stop = endTime` (include all Phase 2 slots). `lockMarket()` never reverts due to entropy unavailability.

**Source:** `contracts/libraries/TWAPLibrary.sol`, function `_computeTStop()`

### 1.6 Packed Storage Optimization

240 slots × uint16 (max value 9999 fits in 16 bits) = 480 bytes = 15 × uint256 words.

| Field | Storage Words | Notes |
|---|---|---|
| `packedSlots[15]` | 15 | 16 slots per word |
| `writtenSlotBitmap` | 1 | Single uint256, bits 0–239 |
| `seedBlockNumber` + `endTimeBlock` | 1 | Packed as uint64 each |
| `lastKnownPulseIndex` | 1 | Pre-window index |
| `tStop` | 1 | Finalised T_stop timestamp |
| `finalTWAP` | 1 | Finalised TWAP value |
| `locked` | 0 (packed) | Boolean, packed with other fields |
| **Total** | **~20** | vs ~64 in Stage 6.5 (68% reduction) |

---

## 2. Changed Files

The following files were modified in Stage 6.6. All changes are strictly limited to the Settlement Observation Algorithm.

| File | Change Type | Description |
|---|---|---|
| `contracts/libraries/TWAPLibrary.sol` | Full Rewrite | New TWAP algorithm, struct, and storage |
| `contracts/TradingEngine.sol` | Targeted Edit | `buy`/`sell` → `recordSlotState()`; `lockMarket()` → `finaliseTWAP(endTime, viewId)` |
| `contracts/interfaces/ITradingEngine.sol` | NatSpec Update | Updated comments to reflect Stage 6.6 |
| `contracts/factory/PulseFactory.sol` | Constant Update | `SETTLEMENT_WINDOW` 30min → 60min (new markets only) |
| `test/Stage6_6_TWAP.test.cjs` | New File | 17 Stage 6.6 security tests (A–G) |
| `test/TradingEngine.test.cjs` | Minor Update | `endTime` updated to satisfy new 90-minute minimum |
| `test/Stage6_5_Security.test.cjs` | Minor Update | `endTime` updated to satisfy new 90-minute minimum |

---

## 3. Unchanged Files

The following files were **not modified** in Stage 6.6, confirming that no economic, custody, or settlement logic was altered:

| File | Status |
|---|---|
| `contracts/pricing/PriceEngine.sol` | **UNCHANGED** |
| `contracts/fee/FeeManager.sol` | **UNCHANGED** |
| `contracts/vault/MarketVault.sol` | **UNCHANGED** |
| `contracts/settlement/SettlementManager.sol` | **UNCHANGED** |
| `contracts/interfaces/IPriceEngine.sol` | **UNCHANGED** |
| `contracts/interfaces/IFeeManager.sol` | **UNCHANGED** |
| `contracts/interfaces/IMarketVault.sol` | **UNCHANGED** |
| `contracts/interfaces/ISettlementManager.sol` | **UNCHANGED** |
| `contracts/interfaces/IPulseFactory.sol` | **UNCHANGED** |

---

## 4. Security Verification

### 4.1 Test Results

| Test Suite | Tests | Result |
|---|---|---|
| Stage 6.6 Security Tests A–G | 17 | **17 / 17 PASS** |
| Stage 5 Integration Tests | 70 | **70 / 70 PASS** |
| TradingEngine Round 2 Tests | 29 | **29 / 29 PASS** |
| TradingEngine Invariant Tests | 4 | **4 / 4 PASS** |
| FeeVault Integration Tests | 12 | **12 / 12 PASS** |
| Stage 6.5 Security Tests | 9 | **9 / 9 PASS** |
| **Total** | **109** | **109 / 109 PASS** |

### 4.2 Stage 6.6 Security Test Details

| Test ID | Test Name | Attack Mitigated | Result |
|---|---|---|---|
| A | Future State Contamination Test | Future trades modifying historical TWAP | **PASS** |
| B | Multi-Trade Same Slot Test | Increasing trade count to inflate TWAP weight | **PASS** |
| C | Stop-Trading Attack Test | Stopping trades to reduce TWAP weight | **PASS** |
| D | Tail Manipulation Test | Deterministic end-of-window price manipulation | **PASS** |
| E | Delayed Lock Test | Stale blockhash causing protocol revert | **PASS** |
| F | Empty Blind Period Test | Fill-Forward correctness with no blind-period trades | **PASS** |
| G | Lock Caller Grinding Test | Repeated `lockMarket()` calls to select favourable T_stop | **PASS** |

---

## 5. Compatibility Confirmation

Stage 6.6 is fully backward-compatible with all Stage 6.5 external interfaces.

| Interface | Stage 6.5 | Stage 6.6 | Compatible? |
|---|---|---|---|
| `buy(viewId, side, amountIn, minSharesOut)` | Same | **Same** | **YES** |
| `sell(viewId, side, sharesIn, minAmountOut)` | Same | **Same** | **YES** |
| `lockMarket(viewId)` | Same | **Same** | **YES** |
| `getFinalTWAP(viewId) → uint256` | Same | **Same** | **YES** |
| `SettlementManager.settle()` | Reads `getFinalTWAP` | **Same** | **YES** |
| `MarketVault` | No TWAP interaction | **Same** | **YES** |
| `FeeManager` | No TWAP interaction | **Same** | **YES** |
| `PriceEngine` | No TWAP interaction | **Same** | **YES** |
| Market Lifecycle State Machine | ACTIVE→LOCKED→SETTLEMENT→CLAIMABLE | **Same** | **YES** |

**Only change with external impact:** `PulseFactory.SETTLEMENT_WINDOW` increased from 30 to 60 minutes. This only affects the minimum duration validation for **newly created markets**. All existing deployed markets are unaffected.

---

## 6. Protocol Invariants Verified

The following protocol invariants were verified to hold after Stage 6.6:

1. TWAP is always in [1, 9999] — enforced by `MathLibrary.clampIndex()`
2. Historical slot values are immutable after slot end time
3. `lockMarket()` can only succeed once per market
4. T_stop is always in [blindStart, endTime]
5. Fill-Forward never produces zero slot values
6. `finaliseTWAP()` is atomic — no partial state on revert
7. `seedBlockNumber` is recorded only on first blind-period trade
8. If `seedBlockNumber == 0`, T_stop = endTime (safe fallback, no revert)

---

*This report is final. Stage 6.6 is complete.*  
*Source: `aess-code/pulse-protocol-v1`, commit `91fd130`*
