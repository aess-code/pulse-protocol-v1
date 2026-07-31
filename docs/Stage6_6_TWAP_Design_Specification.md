# Pulse Protocol V1 Stage 6.6 TWAP Design Specification

**Status:** Design Proposal — Security Hardening Extension  
**Classification:** Stage 6.6 is not a bug fix. It is a **Security Hardening Extension** that replaces the Settlement Observation Algorithm to eliminate end-of-window manipulation risk. The CSM model, Payout formulas, Vault, and Fee mechanisms are entirely unchanged.

---

## 1. Current 30-Minute TWAP Attack Analysis

The Stage 6.5 Security Hardened baseline employs a fixed 30-minute TWAP settlement window with discrete snapshots recorded at most once every 60 seconds. While this mitigates flash-loan and single-block manipulation, it remains vulnerable to **End-of-Window (Tail) Manipulation**:

1.  **Deterministic Closure:** Because the exact `endTime` and the 30-minute window are public and deterministic, an attacker knows precisely when the final snapshots will be recorded.
2.  **Capital Concentration:** An attacker with sufficient capital can wait until the final minutes of the window to execute massive trades, dragging the TWAP across the 5000 boundary.
3.  **Risk-Free Arbitrage:** Since the market closes immediately after `endTime`, the attacker faces no risk of counter-arbitrage after the final snapshot. They can guarantee a `FOR_WINS` or `AGAINST_WINS` outcome and claim the payout, effectively stealing from the opposing side.

The root cause is **determinism of the final snapshot**. To eliminate this, the protocol must remove the attacker's ability to predict which snapshots will be included in the final calculation.

---

## 2. New TWAP Full Flow

The upgraded TWAP mechanism extends the settlement window and introduces a randomized cut-off time that is determined *after* the blind period ends.

**Phase 1 — Confirmed Window (Minutes 0–45):**
The settlement observation window begins 60 minutes before `endTime`. All snapshots recorded in the first 45 minutes (`endTime - 60m` to `endTime - 15m`) are **unconditionally valid** and will be included in the final calculation.

**Phase 2 — Blind Box Period (Minutes 45–60):**
Snapshots continue to be recorded in the final 15 minutes (`endTime - 15m` to `endTime`). However, the system will determine a random cut-off time `T_stop` within this window. Snapshots recorded after `T_stop` will be discarded. Crucially, `T_stop` is not determined at `lockMarket()` time; its value is derived from entropy that is not available until the blind period has already ended (see Section 5).

**Final Calculation:**
`finalTWAP = sum(valid_pulse_indexes) / count(valid_pulse_indexes)`

This is a **discrete equal-weight TWAP approximation**. Each valid snapshot contributes equally to the final index, regardless of the duration between snapshots. This is a deliberate simplification over the time-weighted average used in Stage 6.5, chosen to reduce Gas cost and to avoid giving disproportionate weight to the final snapshot (which could itself be manipulated).

---

## 3. Random Mechanism Security Analysis

The security of this upgrade relies on two properties: **unpredictability before the blind period ends** and **determinism after**.

**Unpredictability:** An attacker trading during the blind period cannot know the value of `T_stop`. They cannot determine whether their trades will produce snapshots that are included or excluded from the final TWAP. This eliminates the certainty required for a risk-free tail manipulation attack.

**Determinism:** Once the blind period ends and the entropy source is finalized (see Section 5), `T_stop` becomes deterministically computable by anyone. This preserves verifiability and prevents disputes.

**Validator Resistance:** The critical constraint is that the entropy source must not be controllable by the `lockMarket()` caller. A validator who calls `lockMarket()` must not be able to choose a block that produces a favorable `T_stop`. This is addressed in Section 5.

---

## 4. Snapshot Trigger Mechanism

The snapshot trigger mechanism is trade-driven and time-constrained. The protocol does **not** promise random-second sampling, as this is not reliably achievable on-chain without an oracle. Instead, the mechanism is:

-   **Condition 1:** `block.timestamp >= endTime - 60 minutes` (within the 60-minute observation window).
-   **Condition 2:** `block.timestamp < endTime` (market has not yet closed).
-   **Condition 3:** `block.timestamp >= lastSnapshotTime + 60 seconds` (at least 60 seconds since the last snapshot).
-   **Condition 4:** `count < 60` (maximum 60 snapshots, one per minute).

If all conditions are met during a `buy()` or `sell()` call, the current Pulse Index and `block.timestamp` are recorded. The exact second within each 60-second interval depends on when the first trade of that interval occurs, providing natural micro-randomness without requiring an oracle.

---

## 5. T_stop Generation Mechanism

The core security requirement is: **the `lockMarket()` caller must not be able to choose the random result**.

**Prohibited Approach:** Generating `T_stop` using `blockhash(block.number - 1)` or `block.timestamp` at the moment of the `lockMarket()` call is **insufficient**. A validator who controls block production can select a block that produces a favorable `T_stop`.

**Recommended Approach — Commit-Reveal with Delayed Entropy:**
`T_stop` is derived from the blockhash of a block that is determined *before* the `lockMarket()` call but whose hash is not known until *after* the blind period ends. Specifically:

1.  At `endTime - 15 minutes` (the start of the blind period), the protocol records the current `block.number` as `entropyBlockNumber`.
2.  `T_stop` is computed during `finaliseTWAP()` as:
    `T_stop = (endTime - 15 minutes) + (uint256(blockhash(entropyBlockNumber + N)) % 900)`
    where `N` is a small fixed constant (e.g., `N = 5`, meaning 5 blocks after the blind period starts).
3.  The blockhash of block `entropyBlockNumber + N` is not known at the time of trading during the blind period, making `T_stop` unpredictable to traders.
4.  The blockhash is available and deterministic by the time `lockMarket()` is called (after `endTime`).

**Limitation:** `blockhash()` in Solidity is only available for the last 256 blocks. If `lockMarket()` is called more than 256 blocks after `entropyBlockNumber + N`, the blockhash returns zero. In this case, the fallback is to use all snapshots in the blind period (i.e., `T_stop = endTime`), which is the conservative safe default.

---

## 6. Fallback Rules

The Stage 4.5 fallback rules are preserved and adapted for the new 60-minute window.

1.  **Valid Snapshots Exist:** If at least one snapshot exists with `timestamp <= T_stop`, the TWAP is:
    `finalTWAP = sum(valid_pulse_indexes) / count(valid_snapshots)`
2.  **Zero Valid Snapshots, Prior Activity:** If no snapshots exist before `T_stop`, but the market had activity before the 60-minute window (`lastIndexBeforeWindow > 0`), the TWAP is `lastIndexBeforeWindow`.
3.  **Zero Activity Ever:** If the market never had any trades, the TWAP defaults to `INITIAL_INDEX` (5000), resulting in a DRAW.
4.  **Stale Blockhash Fallback:** If `blockhash(entropyBlockNumber + N)` returns zero (called too late), all blind period snapshots are included (`T_stop = endTime`).

---

## 7. Gas Impact

-   **Storage:** The `TWAPState` struct buffer increases from 30 to 60 elements. This increases the storage cost of the first snapshot in each new slot.
-   **New State:** One additional `uint256` field (`entropyBlockNumber`) is added to `TWAPState`.
-   **Calculation:** The `finaliseTWAP()` loop increases from 30 to 60 iterations. The calculation changes from a time-weighted average (using `mulDiv`) to a simple sum and division, which is cheaper per iteration.
-   **Overall:** The net Gas impact on `lockMarket()` is a modest increase due to the larger loop. The impact on `buy()` and `sell()` is negligible.

---

## 8. Impact on V1 Frozen Rules

Stage 6.6 is a **Security Hardening Extension** that replaces only the Settlement Observation Algorithm. The following V1 frozen rules are **entirely unchanged**:

-   **CSM Model:** The bonding curve, PriceEngine, and Pulse Index formula are untouched.
-   **Payout Formula:** `FOR_WINS`, `AGAINST_WINS`, and `DRAW` payout calculations are identical.
-   **Vault Custody Model:** The `MarketVault` and all asset custody rules are unaffected.
-   **Fee Model:** The 1.00% fee rate, the 50/30/20 split, and the Pull-over-Push claim model are unchanged.
-   **Market Lifecycle:** The state machine (`ACTIVE` → `LOCKED` → `SETTLEMENT` → `CLAIMABLE`) is unchanged.
-   **Settlement Boundary:** `FOR_WINS` if TWAP > 5000, `AGAINST_WINS` if TWAP < 5000, `DRAW` if TWAP == 5000 — unchanged.

**What changes:** Only the algorithm used to *observe* the market during the settlement window is replaced. The output of that algorithm (a single `finalTWAP` value in basis points) feeds into the same unchanged settlement logic.

---

## 9. Modified File Scope

To implement this design, only the following files require modification:

1.  **`contracts/libraries/TWAPLibrary.sol`** — Update constants (`SETTLEMENT_WINDOW = 60 minutes`, `MAX_SNAPSHOTS = 60`), update `TWAPState` struct (add `entropyBlockNumber`, resize arrays to `[60]`), rewrite `tryRecordSnapshot()` to record `entropyBlockNumber` at the start of the blind period, rewrite `finaliseTWAP()` to compute `T_stop`, filter snapshots, and compute the simple average.
2.  **`contracts/TradingEngine.sol`** — Minor update to `lockMarket()` if any additional parameters are needed.
3.  **`contracts/interfaces/ITradingEngine.sol`** — Update `TWAPState` struct definition to match the new array sizes and new field.
