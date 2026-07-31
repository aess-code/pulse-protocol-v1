# Stage 6.6 Pre-Implementation Architecture Impact Analysis

**Date:** 2026-07-31  
**Status:** Awaiting Approval Before Code Implementation  
**Purpose:** Satisfy the pre-implementation review requirement before any Stage 6.6 code changes begin.

---

## 1. Implementation Constraint Confirmations

All 8 constraints from the Stage 6.6 implementation directive are confirmed:

| # | Constraint | Status |
|---|---|---|
| 1 | Stage 6.6 is strictly limited to replacing Settlement Observation Algorithm only | **CONFIRMED** |
| 2 | PriceEngine.sol, FeeManager.sol, MarketVault.sol, SettlementManager.sol, Market Lifecycle State Machine — not modified | **CONFIRMED** |
| 3 | Dual-Anchor Blockhash is the only approved entropy design. No Chainlink, Oracle, Keeper, VRF, or external randomness | **CONFIRMED** |
| 4 | `seedBlockNumber` recorded only on first trade after `endTime - 15 minutes` | **CONFIRMED** |
| 5 | Historical Slot Immutability preserved. No `latestPulseIndex` reconstruction, no event log as state source | **CONFIRMED** |
| 6 | `lockMarket()` first call permanently determines `T_stop`; ACTIVE → LOCKED; second call reverts | **CONFIRMED** |
| 7 | All security tests A–G must pass before Stage 6.6 is complete | **CONFIRMED** |
| 8 | This document satisfies the pre-implementation review requirement | **THIS DOCUMENT** |

---

## 2. Changed Files List

The following files will be modified. No other files will be touched.

| File | Change Type | Reason |
|---|---|---|
| `contracts/libraries/TWAPLibrary.sol` | **Full Rewrite** | Replace 30-min trade-triggered TWAP with 60-min Fixed-Slot Random-Cutoff TWAP |
| `contracts/TradingEngine.sol` | **Targeted Edit** | Update slot state write in `buy()`/`sell()`; update `lockMarket()` to pass block context and compute `T_stop` |
| `contracts/interfaces/ITradingEngine.sol` | **Targeted Edit** | Update `TWAPState` struct definition; update NatSpec for `lockMarket()` |
| `contracts/factory/PulseFactory.sol` | **Targeted Edit** | Update `SETTLEMENT_WINDOW` constant from 30 minutes to 60 minutes; update `MIN_MARKET_DURATION` accordingly |
| `test/TradingEngine.test.cjs` | **Update** | Update TWAP-related tests to new slot model |
| `test/Stage5Integration.test.cjs` | **Update** | Update `lockMarket()` tests; add Stage 6.6 security tests A–G |

**Files explicitly NOT modified:**

| File | Reason |
|---|---|
| `contracts/pricing/PriceEngine.sol` | No change to pricing logic |
| `contracts/fee/FeeManager.sol` | No change to fee model |
| `contracts/vault/MarketVault.sol` | No change to asset custody |
| `contracts/settlement/SettlementManager.sol` | Reads `getFinalTWAP()` — interface unchanged |
| `contracts/interfaces/IFeeManager.sol` | No change |
| `contracts/interfaces/IMarketVault.sol` | No change |
| `contracts/interfaces/IPulseFactory.sol` | No change |
| `contracts/interfaces/ISettlementManager.sol` | No change |

---

## 3. Architecture Impact Analysis

### 3.1 TWAPLibrary.sol — Full Rewrite

**Current state:** Trade-triggered snapshots, 60-second interval, 30-minute window, max 30 snapshots, time-weighted average.

**New state:** Time-defined 15-second slots, 60-minute window (180 Phase 1 + 60 Phase 2 slots), sparse slot state storage, Dual-Anchor Blockhash `T_stop`, discrete arithmetic mean.

**Impact on other modules:**
-   `TradingEngine.sol` calls `tryRecordSnapshot()` and `finaliseTWAP()`. Both function signatures will change. `TradingEngine.sol` must be updated accordingly.
-   `SettlementManager.sol` calls `tradingEngine.getFinalTWAP(viewId)`. This is a `TradingEngine` function, not a `TWAPLibrary` function. The return value semantics (a Pulse Index in [1, 9999]) are unchanged. **No modification to SettlementManager.sol is required.**

### 3.2 TradingEngine.sol — Targeted Edits

**Change 1 — `buy()` and `sell()`:** Replace `twapStates[viewId].tryRecordSnapshot(newPulseIndex, endTime)` with a new call that writes the current Pulse Index to the slot corresponding to `block.timestamp`. The slot index is computed as `(block.timestamp - (endTime - 60 minutes)) / 15`. If `block.timestamp` is before the observation window, the call is a no-op. The call also records `seedBlockNumber` if this is the first trade in the blind period.

**Change 2 — `lockMarket()`:** After the existing `endTime` and `PERMANENT` checks, add:
1.  Compute `T_stop` using the Dual-Anchor Blockhash formula.
2.  Store `T_stop` in `twapStates[viewId]`.
3.  Call the new `finaliseTWAP(T_stop)` function.
4.  Existing status transition and events are unchanged.

**Change 3 — No new state variables in TradingEngine.sol.** All new state (`seedBlockNumber`, slot storage) lives inside the `TWAPState` struct in `TWAPLibrary.sol`, which is stored in the existing `mapping(uint256 => TWAPLibrary.TWAPState) public twapStates` mapping.

### 3.3 ITradingEngine.sol — Targeted Edit

The `TWAPState` struct is defined in `TWAPLibrary.sol`, not in `ITradingEngine.sol`. The interface file only needs NatSpec updates for `lockMarket()` to reflect the new `T_stop` behaviour. No ABI-breaking changes.

### 3.4 PulseFactory.sol — Targeted Edit

`SETTLEMENT_WINDOW` must be updated from `30 minutes` to `60 minutes` so that the minimum market duration validation (`endTime >= startTime + SETTLEMENT_WINDOW + MIN_TRADING_DURATION`) correctly enforces that markets are long enough for the new 60-minute observation window. `MIN_MARKET_DURATION` will automatically update as it is derived from `SETTLEMENT_WINDOW`.

**Impact:** Markets created after this change must be at least 90 minutes long (60-minute window + 30-minute minimum trading period). Existing markets created under the old 30-minute rule are not affected (they are already deployed).

---

## 4. Storage Layout Changes

### 4.1 TWAPState Struct — Before (Stage 6.5)

```
struct TWAPState {
    uint256[30] pulseIndexSnapshots;   // 30 slots × 32 bytes = 960 bytes (30 storage words)
    uint256[30] timestamps;            // 30 slots × 32 bytes = 960 bytes (30 storage words)
    uint256 count;                     // 1 storage word
    uint256 lastSnapshotTime;          // 1 storage word
    uint256 lastIndexBeforeWindow;     // 1 storage word
    uint256 finalTWAP;                 // 1 storage word
    bool locked;                       // packed into 1 storage word
}
// Total: ~64 storage words per View
```

### 4.2 TWAPState Struct — After (Stage 6.6)

```
struct TWAPState {
    // Packed slot storage: 240 slots × uint16 = 480 bytes = 15 storage words
    uint256[15] packedSlots;           // 15 storage words
    // Sparse write tracking: which slots have been written
    uint256 writtenSlotBitmap;         // 4 storage words (256 bits × 4 = 1024 bits, covers 240 slots)
    // Dual-Anchor Blockhash entropy
    uint64 seedBlockNumber;            // packed
    uint64 endTimeBlock;               // packed (block number at endTime, recorded at first blind period trade)
    // Initial state
    uint256 lastKnownPulseIndex;       // 1 storage word (pre-window index, default INITIAL_INDEX=5000)
    // Finalisation
    uint256 finalTWAP;                 // 1 storage word
    uint256 tStop;                     // 1 storage word (T_stop timestamp, set at lockMarket())
    bool locked;                       // packed
}
// Total: ~23 storage words per View (vs ~64 in Stage 6.5)
// Storage REDUCED by ~64% compared to Stage 6.5
```

**Note:** The exact packing of `seedBlockNumber`, `endTimeBlock`, and `locked` into a single word will be determined during implementation. The above is the logical layout.

### 4.3 Storage Layout Compatibility

-   The `twapStates` mapping in `TradingEngine.sol` remains `mapping(uint256 => TWAPLibrary.TWAPState)`. The mapping key and the mapping itself are unchanged.
-   The `TWAPState` struct is replaced entirely. This is a breaking change for the struct layout, but since `TWAPState` is only accessed through `TradingEngine.sol` (which is being updated), there is no external ABI breakage.
-   `SettlementManager.sol` does not access `TWAPState` directly. It only calls `tradingEngine.getFinalTWAP(viewId)`, which returns a `uint256`. This interface is unchanged.

---

## 5. Compatibility Confirmation with Stage 6.5

| Component | Stage 6.5 Behaviour | Stage 6.6 Behaviour | Compatible? |
|---|---|---|---|
| `buy()` / `sell()` function signatures | `buy(viewId, side, amount, minOut)` | **Unchanged** | **YES** |
| `lockMarket()` function signature | `lockMarket(viewId)` | **Unchanged** | **YES** |
| `getFinalTWAP(viewId)` return type | `uint256` in [1, 9999] | **Unchanged** | **YES** |
| `SettlementManager.settle()` | Reads `getFinalTWAP` | **Unchanged** | **YES** |
| `MarketVault` | No TWAP interaction | **Unchanged** | **YES** |
| `FeeManager` | No TWAP interaction | **Unchanged** | **YES** |
| `PriceEngine` | No TWAP interaction | **Unchanged** | **YES** |
| Market Lifecycle State Machine | ACTIVE→LOCKED→SETTLEMENT→CLAIMABLE | **Unchanged** | **YES** |
| `PulseFactory.SETTLEMENT_WINDOW` | 30 minutes | **60 minutes** | Breaking for new markets only; existing deployed markets unaffected |

**Overall Compatibility Assessment:** Stage 6.6 is fully backward-compatible with all Stage 6.5 external interfaces. The only breaking change is the increase of `SETTLEMENT_WINDOW` in `PulseFactory.sol`, which affects the minimum duration requirement for newly created markets. All existing deployed markets are unaffected.

---

## 6. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| `TWAPState` struct rewrite breaks existing deployed markets | Low | Deployed markets use the old struct; new markets use the new struct. No migration needed for V1. |
| `PulseFactory.SETTLEMENT_WINDOW` change breaks existing tests | Medium | All existing tests that create markets must use `endTime >= startTime + 90 minutes`. Tests will be updated. |
| Dual-Anchor Blockhash `seedBlockNumber` not recorded if no blind period trades | Low | Fallback: if `seedBlockNumber == 0`, `T_stop = endTime` (include all blind period slots). |
| `finaliseTWAP()` gas cost increase (240 slot iteration) | Low | Maximum 240 iterations with simple arithmetic. Estimated 200,000–400,000 Gas. Well within block limits. |

---

## 7. Awaiting Approval

This analysis is provided for your review before any code changes begin.

**No code will be written until you explicitly confirm approval.**

Upon approval, implementation will proceed in the following order:
1.  `contracts/libraries/TWAPLibrary.sol` — Full rewrite.
2.  `contracts/interfaces/ITradingEngine.sol` — NatSpec update.
3.  `contracts/TradingEngine.sol` — Targeted edits to `buy()`, `sell()`, `lockMarket()`.
4.  `contracts/factory/PulseFactory.sol` — Update `SETTLEMENT_WINDOW` constant.
5.  `test/` — Update existing tests and add security tests A–G.
6.  Run full test suite. All tests must pass before submission.
