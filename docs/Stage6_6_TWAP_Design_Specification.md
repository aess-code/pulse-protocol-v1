# Pulse Protocol V1 Stage 6.6 TWAP Design Specification

**Status:** Design Proposal  
**Target:** Dynamic Random Discrete TWAP Upgrade

This document outlines the design specification for upgrading the Time-Weighted Average Price (TWAP) settlement mechanism in Pulse Protocol V1. The upgrade addresses end-of-market manipulation risks by introducing a Dynamic Random Discrete TWAP model.

---

## 1. Current 30-Minute TWAP Attack Analysis

The Stage 6.5 Security Hardened baseline employs a fixed 30-minute TWAP settlement window with snapshots recorded at most once every 60 seconds. While this mitigates flash-loan and single-block manipulation, it remains vulnerable to **End-of-Window (Tail) Manipulation**:

1.  **Deterministic Closure:** Because the exact `endTime` and the 30-minute window are public and deterministic, an attacker knows precisely when the final snapshots will be recorded.
2.  **Capital Concentration:** An attacker with sufficient capital can wait until the final minutes (or seconds) of the window to execute massive trades, dragging the TWAP across the 5000 boundary.
3.  **Risk-Free Arbitrage:** Since the market closes immediately after, the attacker faces no risk of counter-arbitrage. They can guarantee a `FOR_WINS` or `AGAINST_WINS` outcome and claim the payout, effectively stealing from the opposing side.

To eliminate this, the protocol must remove the determinism of the final snapshot.

---

## 2. New TWAP Full Flow

The upgraded TWAP mechanism extends the settlement window and introduces a randomized cut-off time.

1.  **Extended Window:** The settlement observation window is extended from the last 30 minutes to the last **60 minutes** before `endTime`.
2.  **Discrete Snapshots:** Trades trigger snapshots. A snapshot is recorded only if at least 60 seconds have passed since the last snapshot. The exact second within each minute depends on when the first trade of that minute occurs.
3.  **Blind Box Period:**
    -   **First 45 Minutes (`endTime - 60m` to `endTime - 15m`):** All recorded snapshots are strictly valid and must be included in the final calculation.
    -   **Last 15 Minutes (`endTime - 15m` to `endTime`):** The "Blind Box" period. Snapshots continue to be recorded. However, at `lockMarket()`, a random timestamp `T_stop` is generated within this 15-minute window.
4.  **Final Calculation:** Any snapshot recorded *after* `T_stop` is discarded. The final TWAP is the simple arithmetic mean of all valid snapshots up to `T_stop`.

---

## 3. Random Mechanism Security Analysis

The core security of this upgrade relies on the unpredictability of `T_stop`.

-   **Manipulation Mitigation:** An attacker attempting to manipulate the price in the final 15 minutes cannot know if their trades will be included in the TWAP. If they trade after `T_stop` (which is unknown to them at the time), their capital is spent but the TWAP is unaffected.
-   **Counter-Arbitrage Window:** Because the market remains open until `endTime`, any manipulation attempt before `T_stop` leaves the attacker exposed to counter-arbitrage for an unpredictable amount of time.
-   **Randomness Source:** To prevent validators from manipulating `T_stop`, the randomness must be derived from a source unpredictable at the time of trading (e.g., the blockhash of the block containing the `lockMarket()` transaction, combined with previous block data, or an oracle like Chainlink VRF if V1 constraints allow, though block-derived pseudo-randomness is typically sufficient for this specific post-trade resolution).

---

## 4. Snapshot Trigger Mechanism

The trigger mechanism remains trade-driven but time-constrained (Discrete).

-   **Condition 1:** `block.timestamp >= endTime - 60 minutes` AND `block.timestamp < endTime`.
-   **Condition 2:** `block.timestamp >= lastSnapshotTime + 60 seconds`.
-   **Condition 3:** `count < 60` (Maximum 60 snapshots).
-   **Action:** If all conditions are met during a `buy()` or `sell()`, the current Pulse Index and timestamp are recorded in the `TWAPState` buffer.

This ensures exactly one snapshot per minute *if* trading occurs, but the exact second is unpredictable, adding a layer of micro-randomness.

---

## 5. T_stop Generation Mechanism

`T_stop` is generated exactly once during the `TradingEngine.lockMarket()` call.

-   **Window:** `T_stop` must fall strictly within `[endTime - 15 minutes, endTime]`.
-   **Generation (Pseudo-random fallback):** If external oracles are prohibited in V1, `T_stop` can be generated using a pseudo-random function:
    `T_stop = (endTime - 15 minutes) + (uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), block.timestamp, viewId))) % 900)`
-   **Application:** During `finaliseTWAP()`, the loop iterates through the recorded snapshots. Any snapshot where `timestamps[i] > T_stop` is ignored.

---

## 6. Fallback Rules

The Stage 4.5 fallback rules are preserved and adapted for the new 60-minute window.

1.  **Valid Snapshots Exist:** If at least one snapshot exists with `timestamp <= T_stop`, the TWAP is:
    `finalTWAP = sum(valid_pulse_indexes) / number_of_valid_snapshots`
    *(Note: The specification requests a simple average rather than time-weighted average for the valid snapshots).*
2.  **Zero Valid Snapshots, Prior Activity:** If no snapshots exist before `T_stop`, but the market had activity before the 60-minute window (`lastIndexBeforeWindow > 0`), the TWAP is `lastIndexBeforeWindow`.
3.  **Zero Activity Ever:** If the market never had any trades, the TWAP defaults to `INITIAL_INDEX` (5000), resulting in a DRAW.

---

## 7. Gas Impact

-   **Storage:** The `TWAPState` struct buffer increases from 30 to 60 elements (`uint256[60]`). This increases the deployment cost and the cost of the first trade in each minute (due to writing to a new storage slot).
-   **Calculation:** The `finaliseTWAP()` function loop increases from a maximum of 30 iterations to 60 iterations. Because it now uses a simple average (`sum / count`) instead of `mulDiv` for time-weighting, the calculation cost per iteration decreases, partially offsetting the longer loop.
-   **Overall:** The gas impact on `buy()` and `sell()` is negligible (one storage write per minute). The gas impact on `lockMarket()` will increase slightly due to the larger loop and the hashing operation for `T_stop`.

---

## 8. Impact on V1 Frozen Rules

This design strictly adheres to the Stage 6.5 Security Hardened baseline constraints:

-   **No CSM Modification:** The bonding curve and PriceEngine remain completely untouched.
-   **No Pulse Index Formula Modification:** The index calculation remains identical.
-   **No Payout Formula Modification:** `FOR_WINS`, `AGAINST_WINS`, and `DRAW` payouts remain identical.
-   **No Vault/Fee Modification:** The asset custody and fee accounting models are unaffected.
-   **Architecture Preserved:** The TWAP calculation remains isolated within `TWAPLibrary.sol` and is only invoked by `TradingEngine.sol`.

---

## 9. Modified File Scope

To implement this design, only the following files will require modification:

1.  **`contracts/libraries/TWAPLibrary.sol`**
    -   Update constants (`SETTLEMENT_WINDOW = 60 minutes`, `MAX_SNAPSHOTS = 60`).
    -   Update `TWAPState` struct array sizes.
    -   Rewrite `finaliseTWAP()` to generate `T_stop`, filter snapshots, and compute the simple average.
2.  **`contracts/TradingEngine.sol`**
    -   Update `lockMarket()` if necessary to pass additional entropy for `T_stop` generation.
3.  **`contracts/interfaces/ITradingEngine.sol`**
    -   Update `TWAPState` struct definition to match the new array sizes.
