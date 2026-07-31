# Pulse Protocol V1 Stage 6.6 Dynamic TWAP Design Specification

**Status:** Design Proposal — Security Hardening Extension (Revision 8 — Final Engineering Freeze)  
**Classification:** Stage 6.6 replaces only the Settlement Observation Algorithm. The CSM pricing model, Pulse Index formula, Vault custody, Fee mechanics, Settlement Payout formulas, and Market Lifecycle State Machine are entirely unchanged.

---

## 1. Problem Analysis

The Stage 6.5 Security Hardened baseline employs a fixed 30-minute TWAP settlement window. While this mitigates single-block manipulation, it remains vulnerable to **End-of-Window (Tail) Manipulation**:

1.  **Deterministic Closure:** The exact `endTime` and the 30-minute window are public. An attacker knows precisely when the final snapshots will be recorded.
2.  **Capital Concentration:** An attacker with sufficient capital can wait until the final moments of the window to execute massive trades, dragging the TWAP across the 5000 boundary.
3.  **Risk-Free Arbitrage:** Because the market closes immediately after `endTime`, the attacker faces no risk of counter-arbitrage after the final snapshot.

The root cause is the **determinism of the final observation point** combined with a **trade-triggered snapshot model** that allows attackers to control the timing and count of snapshots.

---

## 2. Security Objectives

The Stage 6.6 upgrade is designed to achieve the following security objectives:

1.  **Fully On-Chain Autonomy:** No manual snapshot submission required. No reliance on frontends, Keepers, or external Oracles.
2.  **Unpredictable Cutoff:** Attackers must not know when the final effective snapshot will occur during the entire blind period.
3.  **Validator Resistance:** The caller of `lockMarket()` must not be able to manipulate the random cutoff time.
4.  **Observation Neutrality:** No user can alter the weight of any time period by changing their trading behavior.
5.  **Historical Immutability:** A past slot's value is permanently fixed once the slot ends. Future trades cannot modify past observations.
6.  **Single Lock Execution:** `lockMarket()` executes exactly once. `T_stop` is permanently determined on the first successful call.
7.  **Preserve Trading Logic:** The core `buy()` and `sell()` execution flow remains unchanged.

---

## 3. Dynamic TWAP Architecture

The upgraded mechanism is named **Dynamic Fixed-Slot Random-Cutoff Discrete TWAP**.

The settlement observation window is extended to **60 minutes** before `endTime` and divided into two phases:

**Phase 1: Fixed Observation Period (45 minutes)**
-   Time range: `endTime - 60m` to `endTime - 15m`.
-   Fixed 15-second time slots. Total: 180 slots.
-   All 180 slots are unconditionally included in the final calculation.

**Phase 2: Blind Random Period (15 minutes)**
-   Time range: `endTime - 15m` to `endTime`.
-   Fixed 15-second time slots. Total: 60 slots.
-   A random cutoff time `T_stop` is generated. Slots after `T_stop` are discarded.

**Maximum total slots:** 240 (180 Phase 1 + 60 Phase 2).

---

## 4. Snapshot Slot Principle

**Core Principle: Snapshot slot is time-defined, not trade-triggered.**

Trades do **not** create snapshots. Every 15-second slot is defined by the protocol and exists regardless of whether any trading occurs. A trade only updates the Pulse Index state for the slot in which it occurs.

The following behaviors are explicitly prohibited:
-   Slots are not created by trades. A slot exists even if no trade occurs within it.
-   Increasing trade frequency does not increase a slot's weight.
-   The number of trades does not increase TWAP influence.

Every 15-second slot permanently exists and holds exactly one fixed observation weight.

---

## 5. Slot Final Value Determination

**The final value of a slot is the last valid Pulse Index recorded within that slot before the slot ended.**

This rule applies without exception. It is not the first trade value, not an average, and not the highest or lowest value within the slot.

**Rule:** `slotFinalValue = pulseIndex of the last trade that occurred before slotEndTime`

**Example:**

A slot covers the period `10:00:00` to `10:00:15`. Three trades occur within it:

| Time | Pulse Index |
|---|---|
| 10:00:03 | 6000 |
| 10:00:08 | 7000 |
| 10:00:14 | 8000 |

The final slot value is **8000** — the index of the last trade before the slot ended.

---

## 6. Historical Slot Immutability Rule

**Every 15-second slot is permanently finalized once it ends.**

This is a fundamental protocol invariant that prevents future trades from contaminating past observations.

**Finalization Rules:**

1.  **Slot with trades:** The slot's final value equals the last valid Pulse Index recorded within that slot before the slot ended (see Section 5).
2.  **Slot without trades:** The slot's final value equals the most recent valid Pulse Index from any prior slot or pre-window activity at the time the slot ended.
3.  **Slot finalization is permanent:** Once a slot ends, its value is fixed forever.
4.  **Future trades are bounded:** Any future trade can only affect the current slot and future slots. It is impossible for any future trade to modify the value of a slot that has already ended.

**Slot Finalization is Logical, Not Transaction-Triggered:**

The protocol does not require an automatic transaction to be executed every 15 seconds. Slot finalization is a logical property: once `block.timestamp` has passed the end of a slot, that slot's historical value is logically determined by the last trade that occurred within or before it. No on-chain action is needed to "close" a slot.

**Implementation Constraint:**

The following implementations are explicitly prohibited:
-   A `closeSlot()` function called by a Keeper.
-   Any automated transaction executed every 15 seconds.
-   Any frontend-triggered timed call.

The correct implementation reconstructs the complete historical slot sequence inside `finaliseTWAP()` using only `slotIndex` arithmetic and **sparse slot state storage**. The contract stores the Pulse Index for each slot that received a trade update in a mapping or packed array keyed by slot index. The finalization loop iterates from slot 0 to the last valid slot, carrying forward the last known index to fill any gaps. This reconstruction is entirely deterministic and requires no external input.

**Critical Implementation Note:** Solidity cannot read historical event logs as a state source. The reconstruction must rely exclusively on on-chain storage written during trades. Events are emitted for off-chain indexing only and must never be used as the source of truth for slot state reconstruction.

**Example:**

| Slot | Time | Activity | Final Value |
|---|---|---|---|
| slot 1 | 10:00:00 | No trade, last known index = 5000 | **5000** |
| slot 2 | 10:00:15 | No trade | **5000** (inherits slot 1) |
| slot 3 | 10:00:30 | No trade | **5000** (inherits slot 2) |
| slot 4 | 10:00:45 | Trade occurs, index = 8000 | **8000** |

The value 8000 from slot 4 does **not** retroactively change slots 1, 2, or 3.

---

## 7. Initial State Invariant

**Every slot must have a valid, non-zero initial value before the observation window begins.**

This invariant prevents any slot from containing an uninitialized zero value, which would corrupt the TWAP calculation.

**Rule:**
-   Before the observation window opens (`endTime - 60m`), the protocol must have a valid `lastKnownPulseIndex`.
-   If the market has had any prior trading activity, `lastKnownPulseIndex` is the Pulse Index of the most recent trade.
-   If the market has **never** had any trading activity, `lastKnownPulseIndex` defaults to `INITIAL_INDEX = 5000`.
-   All empty slots at the start of the observation window inherit this initial value via Fill-Forward.

**Guarantee:** No slot will ever contain a zero or undefined value. The minimum valid value for any slot is 1 (the minimum valid Pulse Index).

---

## 8. Protocol Observation Neutrality

**Every 15-second slot holds exactly one fixed observation weight.**

This is a fundamental protocol invariant. No user can alter the weight distribution of the TWAP by changing their trading behavior:

-   **Increasing trade frequency** does not increase a slot's weight. Multiple trades in the same slot overwrite each other; the slot still contributes exactly one value (the last one).
-   **Stopping trading** does not reduce a slot's weight. The Historical Slot Immutability Rule ensures every slot has a value.
-   **Controlling snapshot count** is impossible. The total number of valid slots is determined solely by `T_stop`, which is unknown to all traders during the blind period.

---

## 9. Fill-Forward Rule

**Fill-Forward is applied based on historical slot finalization, not future settlement reconstruction.**

When a slot ends without a trade, it inherits the value of the most recent prior slot at that moment. It does **not** look ahead to future trades.

**Correct behavior:** At the moment slot N ends, if no trade occurred in slot N, its value is set to the value of slot N-1 (or `lastKnownPulseIndex` if no prior slot has a value).

**Prohibited behavior:** At settlement time, retroactively filling all empty historical slots with the value of the last trade that ever occurred.

The Fill-Forward rule applies to both Phase 1 and Phase 2. There is no slot that lacks a value due to inactivity.

---

## 10. Random Cutoff Mechanism — Dual-Anchor Blockhash Design

The random cutoff time `T_stop` must fall strictly between `endTime - 15m` and `endTime`.

**Dual-Anchor Blockhash Mechanism:**

The entropy is derived from two sources that are each unknown to one of the two potential attackers (traders during the blind period, and the `lockMarket()` caller):

1.  **Commit (Blind Period Start):** At the first trade after `endTime - 15m`, the system records the current `block.number` as `seedBlockNumber`.
2.  **Lock-Time Entropy:** At `lockMarket()`, the system uses `blockhash(block.number - 1)` as the second entropy source.
3.  **Combined Entropy:** `T_stop = (endTime - 15 minutes) + (uint256(keccak256(abi.encodePacked(blockhash(seedBlockNumber), blockhash(block.number - 1), viewId))) % 900)`
4.  **Unpredictability during blind period:** `blockhash(block.number - 1)` at lock time is unknown during the blind period.
5.  **Resistance to lock-time manipulation:** The `lockMarket()` caller cannot predict `blockhash(seedBlockNumber)`, which was committed at the start of the blind period.
6.  **Stale Fallback:** If either blockhash returns zero, `T_stop = endTime` (include all blind period slots).

**Lock Execution Window Constraint:**

`lockMarket()` does not require a Keeper, but a maximum delay window must be defined to guarantee `seedBlockNumber`'s blockhash remains within the EVM 256-block limit.

-   **`MAX_LOCK_DELAY_BLOCKS = 150`:** `lockMarket()` must be called within 150 blocks of `endTime`.
-   **Mathematical Guarantee:** `seedBlockNumber` is at most `blindPeriodBlocks + MAX_LOCK_DELAY_BLOCKS` blocks in the past at the time of `lockMarket()`. Setting `MAX_LOCK_DELAY_BLOCKS = 150` ensures this value is always below 256 even on a 12-second chain (75 + 150 = 225 < 256).
-   **Enforcement:** If `block.number > endTimeBlock + MAX_LOCK_DELAY_BLOCKS`, the protocol activates the safe fallback: `T_stop = endTime`. The protocol does not revert.

**Lock Caller Grinding Resistance:**

-   `lockMarket()` must execute exactly once per market. `T_stop` is permanently determined on the first successful call.
-   The market status transitions to `LOCKED` on the first successful call. Any subsequent call to `lockMarket()` must revert because the market is no longer in `ACTIVE` status.
-   This prevents the `lockMarket()` caller from repeatedly calling the function with different blocks to "grind" for a favorable `T_stop`.

---

## 11. Settlement Calculation

The final TWAP calculation is a **discrete arithmetic mean** of all valid slot values.

1.  **Phase 1:** All 180 slots from `endTime - 60m` to `endTime - 15m` are valid.
2.  **Phase 2:** Only slots with `slotEndTime <= T_stop` are valid.
3.  **All slots have values:** Historical Slot Immutability, Initial State Invariant, and the Fill-Forward rule ensure no slot is empty.
4.  **Formula:** `finalIndex = sum(valid_slot_values) / number(valid_slots)`

---

## 12. Fallback Rules

1.  **Zero Trades Ever:** All slots inherit `INITIAL_INDEX` (5000) via Fill-Forward. `finalTWAP = 5000`. Result: `DRAW`.
2.  **Zero Trades in Observation Window:** All slots inherit `lastKnownPulseIndex` via Fill-Forward.
3.  **Stale Entropy (Delayed Lock):** If either blockhash returns zero (lock called after `MAX_LOCK_DELAY_BLOCKS`), `T_stop = endTime` (include all blind period slots).

---

## 13. Storage Design

240 slots cannot be implemented as 240 individual `uint256` storage slots.

**Final Storage Specification:**

-   **Storage Key:** Every stored slot entry must be keyed by its `slotIndex`. Storing only a single `latestPulseIndex` is prohibited.
-   **Packed `uint16` Array:** Store each slot's Pulse Index as `uint16` (range 0–9999 fits in 16 bits). Pack 16 slots per `uint256` storage word. 240 slots require only 15 storage words.
-   **Sparse Map:** Only slots that received a trade update are written to storage. At finalization, the loop iterates all slot indices and fills gaps from the last known value.

**Storage Implementation Invariant:**

Sparse storage optimization **MUST NOT** reconstruct historical slots using future state. When recovering an empty slot at finalization time, the protocol must use the last valid Pulse Index that existed at or before the moment that slot ended. It is strictly prohibited to fill past empty slots with the Pulse Index that exists at the time `finaliseTWAP()` is called.

**Prohibited pattern:** Storing only the single `latestPulseIndex` field and using it to fill all historical empty slots at settlement time.

**Required pattern:** Each stored slot entry must carry its `slotIndex`, enabling the finalization loop to correctly identify which historical value applies to each empty slot.

**Example:**

| Slot | Stored? | Stored Value | Reconstructed Value |
|---|---|---|---|
| slot 1 | Yes | 5000 | 5000 |
| slot 2 | No | — | 5000 (inherits slot 1 at slot 2 end time) |
| slot 3 | Yes | 8000 | 8000 |

Prohibited result: slot 2 = 8000 (using slot 3's value retroactively).

---

## 14. Required Security Tests

The following tests must be implemented before Stage 6.6 is considered complete:

**A. Future State Contamination Test**
-   Setup: Create a market with slots 1–3 having no trades (index = 5000), then execute a large trade in slot 4 (index = 8000).
-   Verify: Slots 1, 2, and 3 finalize at 5000. The value 8000 does not retroactively appear in slots 1–3.

**B. Multi-Trade Same Slot Test**
-   Setup: Execute three trades within a single 15-second slot at indices 6000, 7000, and 8000 respectively.
-   Verify: The slot's final value is 8000 (the last trade). The values 6000 and 7000 are discarded.

**C. Stop-Trading Attack Test**
-   Setup: Execute trades for the first 30 minutes of the observation window, then stop all trading for the final 30 minutes.
-   Verify: All slots in the final 30 minutes inherit the last known index via Fill-Forward. The total number of valid slots and their weights are unchanged.

**D. Tail Manipulation Test**
-   Setup: Execute a large manipulative trade in the final 10 minutes of the blind period.
-   Verify: With high probability, the trade occurs after `T_stop` and is discarded from the TWAP calculation. The test should be run multiple times to confirm the statistical distribution of `T_stop`.

**E. Delayed Lock Test**
-   Setup: Call `lockMarket()` more than `MAX_LOCK_DELAY_BLOCKS` blocks after `endTime`.
-   Verify: The protocol activates the safe fallback (`T_stop = endTime`). All blind period slots are included. The protocol does not revert. The final TWAP is calculated correctly.

**F. Empty Blind Period Test**
-   Setup: Execute trades only during Phase 1, then stop all trading during Phase 2.
-   Verify: All 60 blind period slots inherit the last known Pulse Index from Phase 1 via Fill-Forward. No slot has a zero or undefined value.

**G. Lock Caller Grinding Test**
-   Setup: Call `lockMarket()` successfully once. Attempt to call `lockMarket()` a second time.
-   Verify: The second call reverts because the market is already in `LOCKED` status. `T_stop` remains unchanged from the first call.

---

## 15. Security Analysis

1.  **Last-Second Manipulation:** **Mitigated.** The attacker does not know `T_stop`. A massive trade in the final seconds is highly likely to occur after `T_stop` and be discarded.
2.  **Continuous 15-Minute Manipulation:** **Mitigated.** An attacker must sustain the manipulated price for the entire 15-minute Blind Period to guarantee inclusion, exposing them to prolonged counter-arbitrage risk.
3.  **Stop-Trading Attack:** **Mitigated.** Historical Slot Immutability and Fill-Forward ensure every slot has a value.
4.  **Snapshot Trigger Manipulation:** **Mitigated.** Snapshots are time-defined. A trade can only update the current slot's value, not create additional slots.
5.  **Validator/Miner Manipulation:** **Mitigated.** The Dual-Anchor Blockhash design ensures neither the blind period trader nor the `lockMarket()` caller can predict or control `T_stop`.
6.  **Lock Caller Grinding:** **Mitigated.** `lockMarket()` executes exactly once. The market status transitions to `LOCKED` permanently, preventing repeated calls.
7.  **Future State Contamination Attack:** **Mitigated.** Historical Slot Immutability permanently fixes each slot's value at the time it ends.
8.  **Gas Attack:** **Mitigated.** `finaliseTWAP()` iterates a fixed maximum of 240 slots. This is bounded and predictable.
9.  **Storage Growth:** **Addressed.** The packed storage design limits the on-chain footprint to approximately 15 `uint256` words per View.

---

## 16. Protocol Invariant Checklist

| # | Invariant | Guarantee |
|---|---|---|
| 1 | No manual snapshot submission required | Time-defined slots; trades passively update slot state |
| 2 | No frontend or Keeper dependency | All slot logic is on-chain; slot finalization is logical |
| 3 | Stopping trading does not reduce any time period's weight | Historical Slot Immutability + Fill-Forward |
| 4 | Increasing trade frequency does not increase weight | One value per slot; last trade wins |
| 5 | Future trades cannot modify past TWAP results | Historical Slot Immutability |
| 6 | `T_stop` cannot be predicted during the blind period | Dual-Anchor Blockhash: `blockhash(block.number - 1)` at lock time is unknown during blind period |
| 7 | `T_stop` cannot be manipulated by `lockMarket()` caller | Dual-Anchor Blockhash: `blockhash(seedBlockNumber)` is committed before blind period |
| 8 | `lockMarket()` executes exactly once | Market transitions to `LOCKED`; subsequent calls revert |
| 9 | No slot contains a zero or undefined value | Initial State Invariant + Fill-Forward |
| 10 | Only Settlement Observation Algorithm is modified | All other contracts unchanged |

---

## 17. Gas Impact

-   **Per-Trade:** One conditional storage write when a trade occurs in a new slot. Cost is approximately 20,000 Gas (new slot) or 5,000 Gas (overwrite existing slot).
-   **`lockMarket()`:** Two `blockhash()` calls, one `keccak256` hash, plus a loop of up to 240 iterations with simple arithmetic. Estimated total: 200,000–400,000 Gas, well within block limits.

---

## 18. V1 Compatibility Analysis

Stage 6.6 is a **Security Hardening Extension** that replaces only the Settlement Observation Algorithm. The following V1 frozen rules are **entirely unchanged**:

-   **`PriceEngine.sol`:** CSM logic, Pulse Index formula — untouched.
-   **`FeeManager.sol`:** 1% fee, 50/30/20 split — untouched.
-   **`MarketVault.sol`:** Asset custody, invariants — untouched.
-   **`SettlementManager.sol`:** >5000 FOR_WINS, <5000 AGAINST_WINS, =5000 DRAW, payout formulas — untouched.
-   **Market Lifecycle State Machine:** ACTIVE → LOCKED → SETTLEMENT → CLAIMABLE — untouched.

---

## 19. Implementation Scope

**Files requiring modification:**
-   `contracts/libraries/TWAPLibrary.sol` — Full rewrite of slot logic, Historical Slot Immutability, Fill-Forward, Dual-Anchor Blockhash T_stop generation, and packed storage.
-   `contracts/TradingEngine.sol` — Minor updates to pass slot context during trades and block context at lock time.
-   `contracts/interfaces/ITradingEngine.sol` — Update `TWAPState` struct definition.
-   `test/` — Update existing TWAP tests and add Stage 6.6 security tests A–G (see Section 14).

**Files explicitly not modified:**
-   `contracts/pricing/PriceEngine.sol`
-   `contracts/fee/FeeManager.sol`
-   `contracts/vault/MarketVault.sol`
-   `contracts/settlement/SettlementManager.sol`

---

## 20. Engineering Freeze Checklist

This checklist confirms that the design is complete and ready for code implementation.

| # | Item | Status |
|---|---|---|
| 1 | `contracts/` not modified by this document | **CONFIRMED** |
| 2 | `test/` not modified by this document | **CONFIRMED** |
| 3 | No multiple competing design options remain | **CONFIRMED** — Dual-Anchor Blockhash is the sole selected design |
| 4 | All prohibited implementation patterns are explicitly listed | **CONFIRMED** — Sections 6, 9, 13 |
| 5 | All fallback rules are defined for every failure mode | **CONFIRMED** — Section 12 |
| 6 | Storage specification is unambiguous | **CONFIRMED** — Section 13 |
| 7 | All security tests are specified with Setup and Verify | **CONFIRMED** — Section 14 (A–G) |
| 8 | V1 frozen rules are explicitly confirmed unchanged | **CONFIRMED** — Section 18 |
| 9 | Implementation engineer can implement without ambiguity | **CONFIRMED** |
