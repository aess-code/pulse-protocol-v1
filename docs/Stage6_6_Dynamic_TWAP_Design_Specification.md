# Pulse Protocol V1 Stage 6.6 Dynamic TWAP Design Specification

**Status:** Design Proposal — Security Hardening Extension  
**Classification:** Stage 6.6 replaces the Settlement Observation Algorithm to eliminate end-of-window manipulation risk. It does not alter the CSM pricing model, Pulse Index formula, Vault custody, or Fee mechanics.

---

## 1. Problem Analysis

The Stage 6.5 Security Hardened baseline employs a fixed 30-minute TWAP settlement window. While this mitigates single-block manipulation, it remains vulnerable to **End-of-Window (Tail) Manipulation**:

1.  **Deterministic Closure:** The exact `endTime` and the 30-minute window are public. An attacker knows precisely when the final snapshots will be recorded.
2.  **Capital Concentration:** An attacker with sufficient capital can wait until the final moments of the window to execute massive trades, dragging the TWAP across the 5000 boundary.
3.  **Risk-Free Arbitrage:** Because the market closes immediately after `endTime`, the attacker faces no risk of counter-arbitrage after the final snapshot. They can guarantee a winning outcome and claim the payout, effectively stealing from the opposing side.

To resolve this, the protocol must eliminate the determinism of the final observation point.

---

## 2. Security Objectives

The Stage 6.6 upgrade is designed to achieve the following security objectives:

1.  **Fully On-Chain Autonomy:** No reliance on frontends, Keepers, or external Oracles.
2.  **Unpredictable Cutoff:** Attackers must not know when the final effective snapshot will occur.
3.  **Validator Resistance:** The caller of `lockMarket()` (or the block miner) must not be able to manipulate the random cutoff time.
4.  **No Active Submission Required:** Users do not need to actively submit snapshots; they are passively recorded.
5.  **Preserve Trading Logic:** The core `buy()` and `sell()` execution flow remains unchanged.

---

## 3. Dynamic TWAP Architecture

The upgraded mechanism is named **Dynamic Fixed-Slot Random-Cutoff Discrete TWAP**.

The settlement observation window is extended to **60 minutes** before `endTime` and divided into two phases:

-   **Phase 1: Fixed Observation Period (45 minutes)**
    -   `endTime - 60m` to `endTime - 15m`.
    -   All valid snapshots recorded in this phase are unconditionally included in the final calculation.
-   **Phase 2: Blind Random Period (15 minutes)**
    -   `endTime - 15m` to `endTime`.
    -   Snapshots continue to be recorded, but a random cutoff time (`T_stop`) is generated within this window. Snapshots recorded after `T_stop` are discarded.

---

## 4. Fixed Slot Snapshot Mechanism

To prevent users from intentionally halting trading to avoid snapshots, the mechanism enforces fixed time slots.

-   **Slot Duration:** 15 seconds.
-   **Total Slots:** 60 minutes × 4 slots/minute = 240 slots maximum.
-   **Recording Rule:** During a trade, the system calculates the current `slotIndex` based on `block.timestamp`. It records the current Pulse Index for that slot.
-   **Missing Slots (Fill-Forward):** If a 15-second slot has no trades, it inherits the Pulse Index from the previous valid slot. This ensures that every 15-second interval contributes equally to the TWAP, neutralizing "stop-trading" attacks where an attacker waits for a favorable time to resume.

---

## 5. Random Cutoff Mechanism

The random cutoff time `T_stop` must fall strictly between `endTime - 15m` and `endTime`.

**Security Constraint:** `T_stop` cannot be generated using `blockhash(block.number - 1)` at the moment of `lockMarket()`, as a validator could manipulate this.

**Commit-Reveal Delayed Entropy:**
1.  **Commit:** At the start of the Blind Period (`endTime - 15m`), the system records the current `block.number` as `entropyBlockNumber`.
2.  **Entropy Source:** The randomness is derived from `blockhash(entropyBlockNumber + N)` (where `N` is a small constant, e.g., 5).
3.  **Unpredictability:** During the blind period, traders cannot know the blockhash of a future block.
4.  **Determinism:** By the time `lockMarket()` is called (after `endTime`), the blockhash is fixed and verifiable by all nodes.
5.  **Calculation:** `T_stop = (endTime - 15 minutes) + (uint256(blockhash(entropyBlockNumber + N)) % 900)`

---

## 6. Settlement Calculation

The final TWAP calculation is a **discrete arithmetic mean** of all valid slot snapshots.

1.  **Phase 1:** All slot snapshots from `endTime - 60m` to `endTime - 15m` are valid.
2.  **Phase 2:** Only slot snapshots with `timestamp <= T_stop` are valid.
3.  **Formula:**
    `finalIndex = sum(valid_snapshots) / number(valid_snapshots)`

This equal-weight approach ensures that every 15-second interval has identical influence on the outcome, preventing any single massive trade from disproportionately affecting the TWAP.

---

## 7. Fallback Rules

To ensure protocol liveness under extreme conditions, the following fallbacks are strictly defined:

1.  **Zero Trades Ever:** If the market never had any trades, `finalTWAP = INITIAL_INDEX` (5000). Result: `DRAW`.
2.  **Zero Trades in Observation Window:** If no trades occur in the final 60 minutes, the TWAP uses the last valid Pulse Index recorded before the window opened.
3.  **Entropy Unavailable:** If `lockMarket()` is called more than 256 blocks after `entropyBlockNumber + N` (causing `blockhash` to return 0), the protocol falls back to including the entire Blind Period (`T_stop = endTime`). This is a safe degradation that restores the system to a standard 60-minute TWAP.

---

## 8. Security Analysis

1.  **Last-Second Manipulation:** **Mitigated.** The attacker does not know `T_stop`. A massive trade in the final seconds is highly likely to occur after `T_stop` and be discarded, wasting the attacker's capital.
2.  **Continuous 15-Minute Manipulation:** **Mitigated.** An attacker must sustain the manipulated price for the entire 15-minute Blind Period to guarantee inclusion. This exposes them to massive counter-arbitrage risk for a prolonged duration.
3.  **Stop-Trading Attack:** **Mitigated.** The Fill-Forward mechanism ensures that periods with no trades inherit the previous index. An attacker cannot artificially reduce the weight of a time period by refusing to trade.
4.  **Snapshot Trigger Manipulation:** **Mitigated.** Snapshots are strictly tied to 15-second mathematical slots. A trade can only update the current slot, not future or past slots.
5.  **Validator/Miner Manipulation:** **Mitigated.** `T_stop` is derived from a blockhash determined at the start of the Blind Period, not at `lockMarket()`. A validator cannot selectively call `lockMarket()` to choose a favorable `T_stop`.

---

## 9. Gas Impact

-   **Storage:** Increasing from 30 snapshots to 240 slots requires significant storage if implemented naively. To mitigate this, the implementation should use a ring buffer or packed `uint128` arrays, writing only when a slot transitions.
-   **Execution:** The `buy()` and `sell()` functions will incur a slight Gas increase when crossing a 15-second slot boundary due to the storage write.
-   **Calculation:** `finaliseTWAP()` iterates up to 240 times. Because it uses simple addition rather than `mulDiv` time-weighting, the execution cost remains well within block Gas limits.

---

## 10. V1 Compatibility Analysis

This upgrade strictly adheres to the Stage 6.5 Security Hardened baseline boundaries:

-   **Unchanged:** `PriceEngine.sol` (CSM logic, Pulse Index formula).
-   **Unchanged:** `FeeManager.sol` (1% fee, 50/30/20 split).
-   **Unchanged:** `MarketVault.sol` (Asset custody, invariants).
-   **Unchanged:** `SettlementManager.sol` (>5000 FOR_WINS, <5000 AGAINST_WINS, =5000 DRAW).

The only component modified is the **Settlement Observation Algorithm**.

---

## 11. Implementation Scope

The following files will require modification to implement Stage 6.6:

-   **`contracts/libraries/TWAPLibrary.sol`** (Core logic rewrite for 15-second slots, T_stop generation, and Fill-Forward).
-   **`contracts/TradingEngine.sol`** (Minor updates to pass block context to TWAPLibrary).
-   **`contracts/interfaces/ITradingEngine.sol`** (Update `TWAPState` struct definition).
-   **`test/`** (Update existing TWAP tests and add specific Stage 6.6 security tests).

**Explicitly Not Modified:** `PriceEngine.sol`, `FeeManager.sol`, `MarketVault.sol`, `SettlementManager.sol`.
