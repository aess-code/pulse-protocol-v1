# Pulse Protocol V1 Stage 6.6 Dynamic TWAP Design Specification

**Status:** Design Proposal — Security Hardening Extension (Revision 2)  
**Classification:** Stage 6.6 replaces only the Settlement Observation Algorithm. The CSM pricing model, Pulse Index formula, Vault custody, Fee mechanics, and Settlement Payout formulas are entirely unchanged.

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

1.  **Fully On-Chain Autonomy:** No reliance on frontends, Keepers, or external Oracles.
2.  **Unpredictable Cutoff:** Attackers must not know when the final effective snapshot will occur during the entire blind period.
3.  **Validator Resistance:** The caller of `lockMarket()` must not be able to manipulate the random cutoff time.
4.  **Observation Neutrality:** No user can alter the weight of any time period by changing their trading behavior.
5.  **Preserve Trading Logic:** The core `buy()` and `sell()` execution flow remains unchanged.

---

## 3. Dynamic TWAP Architecture

The upgraded mechanism is named **Dynamic Fixed-Slot Random-Cutoff Discrete TWAP**.

The settlement observation window is extended to **60 minutes** before `endTime` and divided into two phases:

-   **Phase 1: Fixed Observation Period (45 minutes)**
    -   `endTime - 60m` to `endTime - 15m`.
    -   All 180 time slots are unconditionally included in the final calculation.
-   **Phase 2: Blind Random Period (15 minutes)**
    -   `endTime - 15m` to `endTime`.
    -   All 60 time slots are recorded. A random cutoff time `T_stop` is generated. Slots after `T_stop` are discarded.

---

## 4. Fixed Slot Snapshot Mechanism

**Core Principle: Snapshot slot is time-defined, not trade-triggered.**

Trades do **not** trigger snapshots. Instead, trades update the current slot's Pulse Index state. The complete observation sequence is generated at settlement time according to the slot rules.

-   **Slot Duration:** 15 seconds.
-   **Total Slots:** 60 minutes × 4 slots/minute = 240 slots maximum.
-   **Slot Index:** For any timestamp `t` within the observation window, `slotIndex = (t - windowStart) / 15`.
-   **Trade Behavior:** A `buy()` or `sell()` call updates `slotState[slotIndex] = currentPulseIndex`. Multiple trades in the same slot overwrite each other; only the last value in each slot is retained.
-   **Settlement Sequence Generation:** At `finaliseTWAP()`, the protocol iterates through all valid slot indices and applies the Fill-Forward rule to produce the complete observation sequence.

---

## 5. Protocol Observation Neutrality

**Every 15-second slot holds exactly one fixed observation weight.**

This is a fundamental protocol invariant. No user can alter the weight distribution of the TWAP by changing their trading behavior:

-   **Increasing trade frequency** does not increase a slot's weight. Multiple trades in the same slot overwrite each other; the slot still contributes exactly one value.
-   **Stopping trading** does not reduce a slot's weight. The Fill-Forward rule ensures every empty slot inherits the previous valid index and still contributes one value.
-   **Controlling snapshot count** is impossible. The total number of valid slots is determined solely by `T_stop`, which is unknown to all traders during the blind period.

This neutrality guarantee is enforced by the time-defined slot architecture, not by the trading logic.

---

## 6. Fill-Forward Rule

The Fill-Forward rule applies to **both Phase 1 and Phase 2**.

**Rule:** If a slot has no trade activity, it inherits the Pulse Index of the most recent slot that had a valid trade. If no prior slot has any activity, it inherits `lastIndexBeforeWindow`.

**Purpose:** This rule eliminates the "stop-trading attack" where an attacker waits for a favorable moment to resume trading, hoping that periods of inactivity will reduce the weight of unfavorable price periods. Under Fill-Forward, every slot contributes exactly one value regardless of trading activity.

**Implementation:** Fill-Forward is applied lazily at `finaliseTWAP()` time, not during trading. The contract stores only the slots that actually received a trade update. During finalization, it iterates through all slot indices and fills gaps from the last known value.

---

## 7. Random Cutoff Mechanism

The random cutoff time `T_stop` must fall strictly between `endTime - 15m` and `endTime`.

**Security Constraint:** `T_stop` cannot be generated using `blockhash(block.number - 1)` at the moment of `lockMarket()`, as a validator could manipulate this.

**Revised Entropy Design — Delayed Future Block Hash:**

The previous design using `entropyBlockNumber + 5` was identified as insufficient. The attacker could observe the blockhash of `entropyBlockNumber + 5` early in the blind period and infer `T_stop` before the blind period ends.

The corrected design requires the entropy source to remain unknown for the **entire duration** of the blind period:

1.  **Commit:** At the start of the Blind Period (`endTime - 15m`), the system records the current `block.number` as `entropyBlockNumber`.
2.  **Entropy Source:** `T_stop` is derived from `blockhash(entropyBlockNumber + K)`, where `K` is chosen such that block `entropyBlockNumber + K` is not produced until **after** `endTime`. On a 12-second block time, the blind period is 900 seconds = 75 blocks. Therefore, `K >= 75` ensures the entropy block is not mined until after the blind period ends.
3.  **Unpredictability:** During the entire blind period, the blockhash of a future block is unknown to all participants, including validators.
4.  **Determinism:** By the time `lockMarket()` is called (after `endTime`), block `entropyBlockNumber + K` has been mined and its hash is fixed and verifiable.
5.  **Calculation:** `T_stop = (endTime - 15 minutes) + (uint256(blockhash(entropyBlockNumber + K)) % 900)`

**Stale Blockhash Constraint:** `blockhash()` in Solidity is only available for the last 256 blocks. If `lockMarket()` is called more than 256 blocks after `entropyBlockNumber + K`, the hash returns zero. In this case, the fallback is `T_stop = endTime` (include all blind period slots). This is the safe degradation path.

---

## 8. Settlement Calculation

The final TWAP calculation is a **discrete arithmetic mean** of all valid slot snapshots after applying Fill-Forward.

1.  **Phase 1:** All 180 slots from `endTime - 60m` to `endTime - 15m` are valid.
2.  **Phase 2:** Only slots with `slotTimestamp <= T_stop` are valid.
3.  **Fill-Forward:** All empty slots inherit the last known Pulse Index.
4.  **Formula:**
    `finalIndex = sum(valid_slot_values) / number(valid_slots)`

---

## 9. Fallback Rules

1.  **Zero Trades Ever:** `finalTWAP = INITIAL_INDEX` (5000). Result: `DRAW`.
2.  **Zero Trades in Observation Window:** All slots are filled with `lastIndexBeforeWindow` via Fill-Forward. The TWAP equals that index.
3.  **Stale Entropy:** If `blockhash(entropyBlockNumber + K)` returns zero, `T_stop = endTime` (include all blind period slots).

---

## 10. Storage Design

240 slots cannot be implemented as 240 individual `uint256` storage slots, as this would be prohibitively expensive in Gas.

**Recommended Storage Optimization:**

-   **Packed Struct:** Store each slot's Pulse Index as `uint16` (range 0–9999 fits in 16 bits). Pack 16 slots per `uint256` storage word. 240 slots require only 15 storage words.
-   **Sparse Map:** Only store slots that received a trade update. At finalization, Fill-Forward reconstructs the full sequence. This reduces average write cost significantly for low-activity markets.
-   **Ring Buffer (Phase 2 only):** For the 60 blind period slots, a ring buffer of 60 `uint16` values can be used, requiring only 4 storage words.

**Summary:** The full 240-slot observation window can be stored in approximately 15–19 `uint256` storage words, compared to 240 words in a naive implementation.

---

## 11. Security Analysis

1.  **Last-Second Manipulation:** **Mitigated.** The attacker does not know `T_stop`. A massive trade in the final seconds is highly likely to occur after `T_stop` and be discarded.
2.  **Continuous 15-Minute Manipulation:** **Mitigated.** An attacker must sustain the manipulated price for the entire 15-minute Blind Period to guarantee inclusion. This exposes them to massive counter-arbitrage risk for a prolonged duration.
3.  **Stop-Trading Attack:** **Mitigated.** The Fill-Forward mechanism ensures that periods with no trades inherit the previous index. An attacker cannot reduce the weight of a time period by refusing to trade.
4.  **Snapshot Trigger Manipulation:** **Mitigated.** Snapshots are time-defined, not trade-triggered. A trade can only update the current slot's value, not create additional slots or alter the slot count.
5.  **Validator/Miner Manipulation:** **Mitigated.** `T_stop` is derived from `blockhash(entropyBlockNumber + K)` where block `entropyBlockNumber + K` is mined after `endTime`. The validator calling `lockMarket()` cannot select a block to produce a favorable `T_stop`.
6.  **Gas Attack:** **Mitigated.** The `finaliseTWAP()` function iterates a fixed maximum of 240 slots. This is bounded and predictable.
7.  **Storage Growth:** **Addressed.** The packed storage design limits the on-chain footprint to approximately 15–19 `uint256` words per View.

---

## 12. Gas Impact

-   **Per-Trade:** One conditional storage write when a trade occurs in a new slot. Cost is approximately 20,000 Gas (new slot) or 5,000 Gas (overwrite existing slot).
-   **`lockMarket()`:** One `blockhash()` call plus a loop of up to 240 iterations with simple arithmetic. Estimated total: 200,000–400,000 Gas, well within block limits.
-   **Comparison to Stage 6.5:** The per-trade cost is similar. The `lockMarket()` cost increases due to the larger iteration loop, but the simpler arithmetic (no `mulDiv`) partially offsets this.

---

## 13. V1 Compatibility Analysis

Stage 6.6 is a **Security Hardening Extension** that replaces only the Settlement Observation Algorithm. The following V1 frozen rules are **entirely unchanged**:

-   **`PriceEngine.sol`:** CSM logic, Pulse Index formula — untouched.
-   **`FeeManager.sol`:** 1% fee, 50/30/20 split — untouched.
-   **`MarketVault.sol`:** Asset custody, invariants — untouched.
-   **`SettlementManager.sol`:** >5000 FOR_WINS, <5000 AGAINST_WINS, =5000 DRAW, payout formulas — untouched.

The only component modified is the algorithm used to produce the single `finalTWAP` value that feeds into the unchanged settlement logic.

---

## 14. Implementation Scope

**Files requiring modification:**
-   `contracts/libraries/TWAPLibrary.sol` — Full rewrite of slot logic, Fill-Forward, T_stop generation, and packed storage.
-   `contracts/TradingEngine.sol` — Minor updates to pass slot context during trades and block context at lock time.
-   `contracts/interfaces/ITradingEngine.sol` — Update `TWAPState` struct definition.
-   `test/` — Update existing TWAP tests and add Stage 6.6 security tests.

**Files explicitly not modified:**
-   `contracts/pricing/PriceEngine.sol`
-   `contracts/fee/FeeManager.sol`
-   `contracts/vault/MarketVault.sol`
-   `contracts/settlement/SettlementManager.sol`
