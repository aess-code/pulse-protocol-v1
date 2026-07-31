# Pulse Protocol V1 Stage 6.6 Dynamic TWAP Design Specification

**Status:** Design Proposal — Security Hardening Extension (Revision 7 — Engineering Freeze)  
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
6.  **Preserve Trading Logic:** The core `buy()` and `sell()` execution flow remains unchanged.

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

This rule ensures that the most recent market consensus within each time window is the authoritative value, consistent with the principle that the latest trade best reflects current market sentiment.

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

The protocol does not require an automatic transaction to be executed every 15 seconds. Slot finalization is a logical property: once `block.timestamp` has passed the end of a slot, that slot's historical value is logically determined by the last trade that occurred within or before it. No on-chain action is needed to "close" a slot. This ensures the protocol remains fully autonomous with no Keeper or frontend dependency.

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

The value 8000 from slot 4 does **not** retroactively change slots 1, 2, or 3. Those slots were finalized at 5000 when they ended.

---

## 7. Protocol Observation Neutrality

**Every 15-second slot holds exactly one fixed observation weight.**

This is a fundamental protocol invariant. No user can alter the weight distribution of the TWAP by changing their trading behavior:

-   **Increasing trade frequency** does not increase a slot's weight. Multiple trades in the same slot overwrite each other; the slot still contributes exactly one value (the last one).
-   **Stopping trading** does not reduce a slot's weight. The Historical Slot Immutability Rule ensures every slot has a value.
-   **Controlling snapshot count** is impossible. The total number of valid slots is determined solely by `T_stop`, which is unknown to all traders during the blind period.

---

## 8. Fill-Forward Rule

**Fill-Forward is applied based on historical slot finalization, not future settlement reconstruction.**

When a slot ends without a trade, it inherits the value of the most recent prior slot at that moment. It does **not** look ahead to future trades.

**Correct behavior:** At the moment slot N ends, if no trade occurred in slot N, its value is set to the value of slot N-1 (or the last known index before the window if no prior slot has a value).

**Prohibited behavior:** At settlement time, retroactively filling all empty historical slots with the value of the last trade that ever occurred. This would allow future state to contaminate past observations.

The Fill-Forward rule applies to both Phase 1 and Phase 2. There is no slot that lacks a value due to inactivity.

---

## 9. Random Cutoff Mechanism

The random cutoff time `T_stop` must fall strictly between `endTime - 15m` and `endTime`.

**Security Constraint:** `T_stop` cannot be generated using `blockhash(block.number - 1)` at the moment of `lockMarket()`, as a validator could manipulate this.

**T_stop Entropy Design — Recommended Approach for V1:**

Two approaches were evaluated:

| Approach | Description | Pros | Cons |
|---|---|---|---|
| **Dynamic K** | `K = ceil((endTime - block.timestamp) / avgBlockTime) + buffer` | Adapts to any block time | Requires on-chain block time estimation; adds complexity; harder to audit |
| **Fixed Safe Block Distance** | `K = 300` (a fixed constant large enough to exceed the blind period on any realistic L1/L2) | Simple, auditable, no estimation required | Slightly conservative; may delay entropy availability on very fast chains |

**V1 Selection: Dual-Anchor Blockhash (Revised).**

The previously proposed `K = 300` design was identified as incompatible with the EVM `blockhash` 256-block limit. If `lockMarket()` is called more than 256 blocks after `entropyBlockNumber + 300`, the hash returns zero and the fallback activates, defeating the randomness guarantee.

A new design is required that satisfies all constraints simultaneously:
-   Unpredictable during the blind period.
-   Not manipulable by the `lockMarket()` caller.
-   Always within the 256-block `blockhash` window at the time of the `lockMarket()` call.
-   No external oracle.
-   Simple and auditable.

**Revised Mechanism: Lock-Time Blockhash with Blind Period Seed**

The key insight is that the `lockMarket()` caller cannot manipulate `T_stop` if the entropy is derived from a combination of two sources: one committed before the blind period (unknown at lock time) and one from the lock transaction itself (unknown during the blind period). Neither source alone is sufficient for manipulation.

1.  **Commit (Blind Period Start):** At the first trade after `endTime - 15m`, the system records the current `block.number` as `seedBlockNumber`.
2.  **Lock-Time Entropy:** At `lockMarket()`, the system uses `blockhash(block.number - 1)` as the second entropy source.
3.  **Combined Entropy:** `T_stop = (endTime - 15 minutes) + (uint256(keccak256(abi.encodePacked(blockhash(seedBlockNumber), blockhash(block.number - 1), viewId))) % 900)`
4.  **Unpredictability during blind period:** `blockhash(block.number - 1)` at lock time is unknown during the blind period.
5.  **Resistance to lock-time manipulation:** The `lockMarket()` caller cannot predict `blockhash(seedBlockNumber)`, which was committed at the start of the blind period and may be up to 900 seconds (75 blocks on a 12s chain) in the past — well within the 256-block window.
6.  **Blockhash availability:** Both `blockhash(seedBlockNumber)` and `blockhash(block.number - 1)` are always within the 256-block window at the time of the `lockMarket()` call, provided `lockMarket()` is called within `MAX_LOCK_DELAY_BLOCKS` blocks of `endTime`.
7.  **Stale Fallback:** If either blockhash returns zero, `T_stop = endTime` (include all blind period slots).

**Lock Execution Window Constraint:**

`lockMarket()` does not require a Keeper, but a maximum delay window must be defined to guarantee `seedBlockNumber`'s blockhash remains readable.

-   **`MAX_LOCK_DELAY_BLOCKS = 200`:** `lockMarket()` must be called within 200 blocks of `endTime`. On a 12-second chain, this is approximately 40 minutes; on a 2-second chain, approximately 7 minutes. This constant is chosen to be safely below the 256-block EVM limit.
-   **Guarantee:** `seedBlockNumber` is recorded at the start of the blind period (`endTime - 15m`). The blind period is 900 seconds = 75 blocks on a 12s chain. Therefore, at the time `lockMarket()` is called, `seedBlockNumber` is at most `75 + MAX_LOCK_DELAY_BLOCKS = 275` blocks in the past. Since 275 < 256 is **not** satisfied on a 12s chain, the design must account for this.
-   **Revised Guarantee:** To ensure `seedBlockNumber` is always within the 256-block window, `MAX_LOCK_DELAY_BLOCKS` must satisfy: `blindPeriodBlocks + MAX_LOCK_DELAY_BLOCKS < 256`. On a 12s chain, `blindPeriodBlocks = 75`, so `MAX_LOCK_DELAY_BLOCKS < 181`. Setting `MAX_LOCK_DELAY_BLOCKS = 150` provides a safe margin.
-   **Enforcement:** If `block.number > endTimeBlock + MAX_LOCK_DELAY_BLOCKS`, the protocol activates the safe fallback: `T_stop = endTime` (include all blind period slots). This ensures the protocol degrades gracefully without reverting.

---

## 10. Settlement Calculation

The final TWAP calculation is a **discrete arithmetic mean** of all valid slot values.

1.  **Phase 1:** All 180 slots from `endTime - 60m` to `endTime - 15m` are valid.
2.  **Phase 2:** Only slots with `slotEndTime <= T_stop` are valid.
3.  **All slots have values:** Historical Slot Immutability and the Fill-Forward rule ensure no slot is empty.
4.  **Formula:** `finalIndex = sum(valid_slot_values) / number(valid_slots)`

---

## 11. Fallback Rules

1.  **Zero Trades Ever:** All slots inherit `INITIAL_INDEX` (5000) via Fill-Forward. `finalTWAP = 5000`. Result: `DRAW`.
2.  **Zero Trades in Observation Window:** All slots inherit `lastIndexBeforeWindow` via Fill-Forward.
3.  **Stale Entropy:** If `blockhash(entropyBlockNumber + 300)` returns zero, `T_stop = endTime` (include all blind period slots). This is the safe degradation path.

---

## 12. Storage Design

240 slots cannot be implemented as 240 individual `uint256` storage slots.

**Recommended Storage Optimization:**

-   **Packed `uint16` Array:** Store each slot's Pulse Index as `uint16` (range 0–9999 fits in 16 bits). Pack 16 slots per `uint256` storage word. 240 slots require only 15 storage words.
-   **Sparse Map with Slot Timestamp:** Store only the slots that received a trade update (sparse). Each stored entry must carry both the slot index and the Pulse Index at the time of the trade. At finalization, iterate through all slot indices and fill gaps using the last known value at the time each slot ended.

**Storage Implementation Invariant:**

Sparse storage optimization **MUST NOT** reconstruct historical slots using future state. When recovering an empty slot at finalization time, the protocol must use the last valid Pulse Index that existed at or before the moment that slot ended. It is strictly prohibited to fill past empty slots with the Pulse Index that exists at the time `finaliseTWAP()` is called.

**Prohibited pattern:** Storing only the single `latestPulseIndex` field and using it to fill all historical empty slots at settlement time.

**Required pattern:** Each stored slot entry must carry its slot index (or timestamp), enabling the finalization loop to correctly identify which historical value applies to each empty slot.

**Example:**

| Slot | Stored? | Stored Value | Reconstructed Value |
|---|---|---|---|
| slot 1 | Yes | 5000 | 5000 |
| slot 2 | No | — | 5000 (inherits slot 1 at slot 2 end time) |
| slot 3 | Yes | 8000 | 8000 |

Prohibited result: slot 2 = 8000 (using slot 3's value retroactively).

---

## 13. Required Security Tests

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
-   Setup: Call `lockMarket()` more than `MAX_LOCK_DELAY_BLOCKS` blocks after `endTime`, simulating a scenario where the `seedBlockNumber` blockhash has become unavailable.
-   Verify: The protocol activates the safe fallback (`T_stop = endTime`). All blind period slots are included. The protocol does not revert. The final TWAP is calculated correctly using all available slots.

**F. Empty Blind Period Test**
-   Setup: Execute trades only during Phase 1 (the first 45 minutes), then stop all trading during Phase 2 (the blind period). No trades occur in the blind period.
-   Verify: All 60 blind period slots inherit the last known Pulse Index from Phase 1 via Fill-Forward. The total slot count and TWAP calculation are correct. The absence of trades in the blind period does not cause any slot to have a zero or undefined value.

---

## 14. Security Analysis

1.  **Last-Second Manipulation:** **Mitigated.** The attacker does not know `T_stop`. A massive trade in the final seconds is highly likely to occur after `T_stop` and be discarded.
2.  **Continuous 15-Minute Manipulation:** **Mitigated.** An attacker must sustain the manipulated price for the entire 15-minute Blind Period to guarantee inclusion, exposing them to prolonged counter-arbitrage risk.
3.  **Stop-Trading Attack:** **Mitigated.** Historical Slot Immutability and Fill-Forward ensure every slot has a value. Stopping trading only causes future empty slots to inherit the current index.
4.  **Snapshot Trigger Manipulation:** **Mitigated.** Snapshots are time-defined. A trade can only update the current slot's value, not create additional slots.
5.  **Validator/Miner Manipulation:** **Mitigated.** `T_stop` is derived from `blockhash(entropyBlockNumber + 300)` where that block is mined after `endTime`. The validator calling `lockMarket()` cannot select a block to produce a favorable `T_stop`.
6.  **Future State Contamination Attack:** **Mitigated.** Historical Slot Immutability permanently fixes each slot's value at the time it ends. Future trades only affect current and future slots.
7.  **Gas Attack:** **Mitigated.** `finaliseTWAP()` iterates a fixed maximum of 240 slots. This is bounded and predictable.
8.  **Storage Growth:** **Addressed.** The packed storage design limits the on-chain footprint to approximately 15 `uint256` words per View.

---

## 15. Protocol Invariant Checklist

| # | Invariant | Guarantee |
|---|---|---|
| 1 | No manual snapshot submission required | Time-defined slots; trades passively update slot state |
| 2 | No frontend or Keeper dependency | All slot logic is on-chain; slot finalization is logical |
| 3 | Stopping trading does not reduce any time period's weight | Historical Slot Immutability + Fill-Forward |
| 4 | Increasing trade frequency does not increase weight | One value per slot; last trade wins |
| 5 | Future trades cannot modify past TWAP results | Historical Slot Immutability |
| 6 | `T_stop` cannot be predicted during the blind period | Entropy from `blockhash(entropyBlockNumber + 300)` |
| 7 | `T_stop` cannot be manipulated by `lockMarket()` caller | Entropy block is mined after `endTime` |
| 8 | Only Settlement Observation Algorithm is modified | All other contracts unchanged |

---

## 16. Gas Impact

-   **Per-Trade:** One conditional storage write when a trade occurs in a new slot. Cost is approximately 20,000 Gas (new slot) or 5,000 Gas (overwrite existing slot).
-   **`lockMarket()`:** One `blockhash()` call plus a loop of up to 240 iterations with simple arithmetic. Estimated total: 200,000–400,000 Gas, well within block limits.

---

## 17. V1 Compatibility Analysis

Stage 6.6 is a **Security Hardening Extension** that replaces only the Settlement Observation Algorithm. The following V1 frozen rules are **entirely unchanged**:

-   **`PriceEngine.sol`:** CSM logic, Pulse Index formula — untouched.
-   **`FeeManager.sol`:** 1% fee, 50/30/20 split — untouched.
-   **`MarketVault.sol`:** Asset custody, invariants — untouched.
-   **`SettlementManager.sol`:** >5000 FOR_WINS, <5000 AGAINST_WINS, =5000 DRAW, payout formulas — untouched.
-   **Market Lifecycle State Machine:** ACTIVE → LOCKED → SETTLEMENT → CLAIMABLE — untouched.

---

## 18. Implementation Scope

**Files requiring modification:**
-   `contracts/libraries/TWAPLibrary.sol` — Full rewrite of slot logic, Historical Slot Immutability, Fill-Forward, T_stop generation, and packed storage.
-   `contracts/TradingEngine.sol` — Minor updates to pass slot context during trades and block context at lock time.
-   `contracts/interfaces/ITradingEngine.sol` — Update `TWAPState` struct definition.
-   `test/` — Update existing TWAP tests and add Stage 6.6 security tests (see Section 13).

**Files explicitly not modified:**
-   `contracts/pricing/PriceEngine.sol`
-   `contracts/fee/FeeManager.sol`
-   `contracts/vault/MarketVault.sol`
-   `contracts/settlement/SettlementManager.sol`
