# Pulse Protocol V1 Stage 6.6 Dynamic TWAP Design Specification

**Status:** Design Proposal — Security Hardening Extension (Revision 4)  
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

## 5. Historical Slot Immutability Rule

**Every 15-second slot is permanently finalized once it ends.**

This is a fundamental protocol invariant that prevents future trades from contaminating past observations.

**Finalization Rules:**

1.  **Slot with trades:** The slot's final value equals the last valid Pulse Index recorded within that slot before the slot ended.
2.  **Slot without trades:** The slot's final value equals the most recent valid Pulse Index from any prior slot or pre-window activity at the time the slot ended.
3.  **Slot finalization is permanent:** Once a slot ends, its value is fixed forever.
4.  **Future trades are bounded:** Any future trade can only affect the current slot and future slots. It is impossible for any future trade to modify the value of a slot that has already ended.

**Slot Finalization is Logical, Not Transaction-Triggered:**

The protocol does not require an automatic transaction to be executed every 15 seconds. Slot finalization is a logical property: once `block.timestamp` has passed the end of a slot, that slot's historical value is logically determined by the last trade that occurred within or before it. No on-chain action is needed to "close" a slot. This ensures the protocol remains fully autonomous with no Keeper or frontend dependency.

**Example:**

| Slot | Time | Activity | Final Value |
|---|---|---|---|
| slot 1 | 10:00:00 | No trade, last known index = 5000 | **5000** |
| slot 2 | 10:00:15 | No trade | **5000** (inherits slot 1) |
| slot 3 | 10:00:30 | No trade | **5000** (inherits slot 2) |
| slot 4 | 10:00:45 | Trade occurs, index = 8000 | **8000** |

The value 8000 from slot 4 does **not** retroactively change slots 1, 2, or 3. Those slots were finalized at 5000 when they ended.

---

## 6. Protocol Observation Neutrality

**Every 15-second slot holds exactly one fixed observation weight.**

This is a fundamental protocol invariant. No user can alter the weight distribution of the TWAP by changing their trading behavior:

-   **Increasing trade frequency** does not increase a slot's weight. Multiple trades in the same slot overwrite each other; the slot still contributes exactly one value.
-   **Stopping trading** does not reduce a slot's weight. The Historical Slot Immutability Rule ensures every slot has a value, derived from the last known index at the time the slot ended.
-   **Controlling snapshot count** is impossible. The total number of valid slots is determined solely by `T_stop`, which is unknown to all traders during the blind period.

---

## 7. Fill-Forward Rule

**Fill-Forward is applied based on historical slot finalization, not future settlement reconstruction.**

This is a critical distinction. The correct model is forward-propagation in time: when a slot ends without a trade, it inherits the value of the most recent prior slot at that moment. It does **not** look ahead to future trades.

**Correct behavior:**
-   At the moment slot N ends, if no trade occurred in slot N, its value is set to the value of slot N-1 (or the last known index before the window if no prior slot has a value).

**Prohibited behavior:**
-   At settlement time, retroactively filling all empty historical slots with the value of the last trade that ever occurred. This would allow future state to contaminate past observations.

The Fill-Forward rule applies to both Phase 1 and Phase 2. There is no slot that lacks a value due to inactivity.

---

## 8. Random Cutoff Mechanism

The random cutoff time `T_stop` must fall strictly between `endTime - 15m` and `endTime`.

**Security Constraint:** `T_stop` cannot be generated using `blockhash(block.number - 1)` at the moment of `lockMarket()`, as a validator could manipulate this.

**Delayed Future Block Hash:**

1.  **Commit:** At the start of the Blind Period (`endTime - 15m`), the system records the current `block.number` as `entropyBlockNumber`.
2.  **Entropy Source:** `T_stop` is derived from `blockhash(entropyBlockNumber + K)`, where `K` must be selected dynamically to ensure that block `entropyBlockNumber + K` is mined **after** `endTime`. The value of `K` must not be hardcoded based on a fixed block time assumption. Instead, `K` should be calculated at the time `entropyBlockNumber` is recorded as: `K = ceil((endTime - block.timestamp) / averageBlockTime) + safetyBuffer`, where `averageBlockTime` is a conservative on-chain estimate and `safetyBuffer` is a small constant (e.g., 10 blocks) to account for block time variance. This ensures the entropy block is mined after `endTime` regardless of network conditions.
3.  **Unpredictability:** During the entire blind period, the blockhash of a future block is unknown to all participants, including validators.
4.  **Determinism:** By the time `lockMarket()` is called (after `endTime`), block `entropyBlockNumber + K` has been mined and its hash is fixed and verifiable.
5.  **Calculation:** `T_stop = (endTime - 15 minutes) + (uint256(blockhash(entropyBlockNumber + K)) % 900)`

---

## 9. Settlement Calculation

The final TWAP calculation is a **discrete arithmetic mean** of all valid slot values.

1.  **Phase 1:** All 180 slots from `endTime - 60m` to `endTime - 15m` are valid.
2.  **Phase 2:** Only slots with `slotEndTime <= T_stop` are valid.
3.  **All slots have values:** Historical Slot Immutability and the Fill-Forward rule ensure no slot is empty.
4.  **Formula:** `finalIndex = sum(valid_slot_values) / number(valid_slots)`

---

## 10. Fallback Rules

1.  **Zero Trades Ever:** All slots inherit `INITIAL_INDEX` (5000) via Fill-Forward. `finalTWAP = 5000`. Result: `DRAW`.
2.  **Zero Trades in Observation Window:** All slots inherit `lastIndexBeforeWindow` via Fill-Forward.
3.  **Stale Entropy:** If `blockhash(entropyBlockNumber + K)` returns zero (called more than 256 blocks late), `T_stop = endTime` (include all blind period slots). This is the safe degradation path.

---

## 11. Storage Design

240 slots cannot be implemented as 240 individual `uint256` storage slots.

**Recommended Storage Optimization:**

-   **Packed `uint16` Array:** Store each slot's Pulse Index as `uint16` (range 0–9999 fits in 16 bits). Pack 16 slots per `uint256` storage word. 240 slots require only 15 storage words.
-   **Sparse Map with Last-Known-Index:** Store only the slots that received a trade update (sparse). Additionally, store the `lastKnownIndex` at the time of each write. At finalization, iterate through all slot indices and fill gaps using the last known value at the time each slot ended.
-   **Critical Requirement:** The storage design must preserve the finalized value of each slot as it was at the time the slot ended. Storing only the last trade index is insufficient, as it would not allow correct reconstruction of historical slot values.

**Storage Implementation Invariant:**

Sparse storage optimization **MUST NOT** reconstruct historical slots using future state. When recovering an empty slot at finalization time, the protocol must use the last valid Pulse Index that existed at or before the moment that slot ended. It is strictly prohibited to fill past empty slots with the Pulse Index that exists at the time `finaliseTWAP()` is called.

Example:
-   slot 1 ends with Index = 5000 (last known at that time)
-   slot 2 ends with no trade → inherits 5000 (last known at slot 2 end time)
-   slot 3 has a trade → Index = 8000

Correct result: `slot1 = 5000, slot2 = 5000, slot3 = 8000`

Prohibited result: `slot1 = 8000, slot2 = 8000` (using future state to fill past slots)

---

## 12. Security Analysis

1.  **Last-Second Manipulation:** **Mitigated.** The attacker does not know `T_stop`. A massive trade in the final seconds is highly likely to occur after `T_stop` and be discarded.
2.  **Continuous 15-Minute Manipulation:** **Mitigated.** An attacker must sustain the manipulated price for the entire 15-minute Blind Period to guarantee inclusion, exposing them to prolonged counter-arbitrage risk.
3.  **Stop-Trading Attack:** **Mitigated.** Historical Slot Immutability and Fill-Forward ensure every slot has a value. Stopping trading only causes future empty slots to inherit the current index; it does not reduce the weight of past slots.
4.  **Snapshot Trigger Manipulation:** **Mitigated.** Snapshots are time-defined. A trade can only update the current slot's value, not create additional slots.
5.  **Validator/Miner Manipulation:** **Mitigated.** `T_stop` is derived from `blockhash(entropyBlockNumber + K)` where block `entropyBlockNumber + K` is mined after `endTime`. The validator calling `lockMarket()` cannot select a block to produce a favorable `T_stop`.
6.  **Future State Contamination Attack:** **Mitigated.** An attacker cannot wait for multiple empty slots and then execute a large trade to retroactively change the values of those slots. Historical Slot Immutability permanently fixes each slot's value at the time it ends. Future trades only affect current and future slots.
7.  **Gas Attack:** **Mitigated.** `finaliseTWAP()` iterates a fixed maximum of 240 slots. This is bounded and predictable.
8.  **Storage Growth:** **Addressed.** The packed storage design limits the on-chain footprint to approximately 15–19 `uint256` words per View.

---

## 13. Protocol Invariant Checklist

The following invariants must hold in the final implementation:

| # | Invariant | Guarantee |
|---|---|---|
| 1 | No manual snapshot submission required | Time-defined slots; trades passively update slot state |
| 2 | No frontend or Keeper dependency | All slot logic is on-chain |
| 3 | Stopping trading does not reduce any time period's weight | Historical Slot Immutability + Fill-Forward |
| 4 | Increasing trade frequency does not increase weight | One value per slot; overwrites are idempotent |
| 5 | Future trades cannot modify past TWAP results | Historical Slot Immutability |
| 6 | `T_stop` cannot be predicted during the blind period | Entropy from future block hash (`entropyBlockNumber + K`) |
| 7 | `T_stop` cannot be manipulated by `lockMarket()` caller | Entropy block is mined after `endTime` |
| 8 | Only Settlement Observation Algorithm is modified | All other contracts unchanged |

---

## 14. Gas Impact

-   **Per-Trade:** One conditional storage write when a trade occurs in a new slot. Cost is approximately 20,000 Gas (new slot) or 5,000 Gas (overwrite existing slot).
-   **`lockMarket()`:** One `blockhash()` call plus a loop of up to 240 iterations with simple arithmetic. Estimated total: 200,000–400,000 Gas, well within block limits.

---

## 15. V1 Compatibility Analysis

Stage 6.6 is a **Security Hardening Extension** that replaces only the Settlement Observation Algorithm. The following V1 frozen rules are **entirely unchanged**:

-   **`PriceEngine.sol`:** CSM logic, Pulse Index formula — untouched.
-   **`FeeManager.sol`:** 1% fee, 50/30/20 split — untouched.
-   **`MarketVault.sol`:** Asset custody, invariants — untouched.
-   **`SettlementManager.sol`:** >5000 FOR_WINS, <5000 AGAINST_WINS, =5000 DRAW, payout formulas — untouched.
-   **Market Lifecycle State Machine:** ACTIVE → LOCKED → SETTLEMENT → CLAIMABLE — untouched.

---

## 16. Implementation Scope

**Files requiring modification:**
-   `contracts/libraries/TWAPLibrary.sol` — Full rewrite of slot logic, Historical Slot Immutability, Fill-Forward, T_stop generation, and packed storage.
-   `contracts/TradingEngine.sol` — Minor updates to pass slot context during trades and block context at lock time.
-   `contracts/interfaces/ITradingEngine.sol` — Update `TWAPState` struct definition.
-   `test/` — Update existing TWAP tests and add Stage 6.6 security tests.

**Files explicitly not modified:**
-   `contracts/pricing/PriceEngine.sol`
-   `contracts/fee/FeeManager.sol`
-   `contracts/vault/MarketVault.sol`
-   `contracts/settlement/SettlementManager.sol`
