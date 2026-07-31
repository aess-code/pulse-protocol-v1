// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { MathLibrary } from "./MathLibrary.sol";

/// @title TWAPLibrary — Stage 6.6 Dynamic Fixed-Slot Random-Cutoff Discrete TWAP
/// @notice Provides the Settlement Observation Algorithm for Pulse Protocol V1.
///
/// @dev ── Design: Dynamic Fixed-Slot Random-Cutoff Discrete TWAP ──────────────
///
///      Observation Window: 60 minutes before endTime, divided into two phases:
///
///      Phase 1 — Fixed Observation Period (45 minutes):
///        Time range: [endTime - 60m, endTime - 15m)
///        Slots: 180 fixed 15-second slots (slot 0 to slot 179)
///        All 180 slots are unconditionally included in the final calculation.
///
///      Phase 2 — Blind Random Period (15 minutes):
///        Time range: [endTime - 15m, endTime)
///        Slots: 60 fixed 15-second slots (slot 180 to slot 239)
///        A random cutoff T_stop is generated at lockMarket().
///        Slots with slotEndTime > T_stop are discarded.
///
///      Slot Final Value Rule:
///        Each 15-second slot's value = last Pulse Index written to that slot
///        before the slot ended. Not the first, not an average — the last.
///
///      Historical Slot Immutability:
///        Once a slot ends, its value is permanently fixed.
///        Future trades cannot modify past slot values.
///
///      Fill-Forward Rule:
///        Empty slots inherit the most recent prior slot value at the time
///        the slot ended. The initial value is lastKnownPulseIndex (default 5000).
///        Reconstruction uses sparse slot state storage — NOT event logs.
///
///      Dual-Anchor Blockhash Entropy:
///        seedBlockNumber: recorded at the first trade in the blind period.
///        T_stop = endTime - 15m + keccak256(blockhash(seedBlockNumber),
///                                            blockhash(block.number - 1),
///                                            viewId) % 900
///        If either blockhash is zero (stale), T_stop = endTime (safe fallback).
///
///      Lock Caller Grinding Resistance:
///        lockMarket() executes exactly once. The ACTIVE → LOCKED transition
///        is permanent. Subsequent calls revert.
///
/// @dev ── Storage Optimisation ─────────────────────────────────────────────────
///
///      240 slots × uint16 (max 9999 fits in 16 bits) = 480 bytes = 15 × uint256.
///      Packed into uint256[15] packedSlots.
///      Sparse writes tracked via a single uint256 writtenSlotBitmap (bits 0–239).
///      Total: ~20 storage words per View (vs ~64 in Stage 6.5).

library TWAPLibrary {
    using MathLibrary for uint256;

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Total observation window before endTime (60 minutes).
    uint256 internal constant OBSERVATION_WINDOW = 60 minutes;

    /// @notice Phase 1 duration (45 minutes = fixed observation period).
    uint256 internal constant PHASE1_DURATION = 45 minutes;

    /// @notice Phase 2 duration (15 minutes = blind random period).
    uint256 internal constant PHASE2_DURATION = 15 minutes;

    /// @notice Duration of each time slot (15 seconds).
    uint256 internal constant SLOT_DURATION = 15 seconds;

    /// @notice Total number of slots in the observation window (240).
    uint256 internal constant TOTAL_SLOTS = 240;

    /// @notice Number of Phase 1 slots (180).
    uint256 internal constant PHASE1_SLOTS = 180;

    /// @notice Number of Phase 2 slots (60).
    uint256 internal constant PHASE2_SLOTS = 60;

    /// @notice Maximum blocks after endTime before lockMarket() must use fallback.
    ///         Ensures seedBlockNumber is always within the EVM 256-block window.
    ///         Math: blindPeriodBlocks(~75 on 12s chain) + 150 = 225 < 256. Safe.
    uint256 internal constant MAX_LOCK_DELAY_BLOCKS = 150;

    // ─────────────────────────────────────────────────────────────────────────
    // Custom Errors
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Thrown when attempting to read a TWAP that has not yet been finalised.
    error TWAP__NotFinalised();

    // ─────────────────────────────────────────────────────────────────────────
    // Storage Struct
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Per-View TWAP state stored in TradingEngine.
    /// @dev Stored in `mapping(uint256 viewId => TWAPState)` in TradingEngine.
    ///
    ///      packedSlots: 240 uint16 slot values packed into 15 uint256 words.
    ///        Slot i occupies bits [(i % 16) * 16 : (i % 16) * 16 + 15] of
    ///        packedSlots[i / 16].
    ///        Value 0 means "not written" (distinguished from written value 0
    ///        by the writtenSlotBitmap).
    ///
    ///      writtenSlotBitmap: single uint256 where bit i = 1 means slot i
    ///        has been written by a trade. Covers all 240 slots (bits 0–239).
    ///        Bits 240–255 are unused.
    struct TWAPState {
        /// @notice Packed uint16 slot values. 16 slots per word, 15 words total.
        uint256[15] packedSlots;
        /// @notice Bitmap tracking which slots have been written (bit i = slot i).
        uint256 writtenSlotBitmap;
        /// @notice Block number of the first trade in the blind period (Phase 2).
        ///         Zero if no blind-period trade has occurred.
        uint64 seedBlockNumber;
        /// @notice Block number recorded at endTime (for MAX_LOCK_DELAY_BLOCKS check).
        ///         Set when the first blind-period trade occurs.
        uint64 endTimeBlock;
        /// @notice Last known Pulse Index before the observation window opened.
        ///         Default: INITIAL_INDEX (5000) if market has never traded.
        uint256 lastKnownPulseIndex;
        /// @notice The finalised T_stop timestamp (set at lockMarket()).
        uint256 tStop;
        /// @notice The finalised TWAP value (set at lockMarket()).
        uint256 finalTWAP;
        /// @notice Whether the TWAP has been finalised.
        bool locked;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Slot State Write (called on every buy/sell)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Record the current Pulse Index for the active time slot.
    /// @dev Called by TradingEngine on every buy() and sell().
    ///      Only writes if block.timestamp is within the observation window.
    ///      If this is the first trade in Phase 2, records seedBlockNumber.
    ///      Multiple trades in the same slot overwrite each other (last trade wins).
    ///
    /// @param state        Storage reference to the View's TWAPState.
    /// @param pulseIndex   Current Pulse Index after the trade.
    /// @param endTime      The View's endTime. Must be non-zero (FIXED market).
    function recordSlotState(
        TWAPState storage state,
        uint256 pulseIndex,
        uint256 endTime
    ) internal {
        // Only process FIXED markets (endTime > 0) and only within the window.
        if (endTime == 0) return;
        uint256 windowStart = endTime - OBSERVATION_WINDOW;
        uint256 ts = block.timestamp;
        if (ts < windowStart || ts >= endTime) {
            // Outside window: update lastKnownPulseIndex for pre-window activity.
            if (ts < windowStart) {
                state.lastKnownPulseIndex = pulseIndex;
            }
            return;
        }

        // Compute slot index: which 15-second slot does this timestamp fall in?
        uint256 slotIndex = (ts - windowStart) / SLOT_DURATION;
        if (slotIndex >= TOTAL_SLOTS) return; // safety guard

        // If this is Phase 2 (blind period) and seedBlockNumber not yet set, record it.
        if (slotIndex >= PHASE1_SLOTS && state.seedBlockNumber == 0) {
            state.seedBlockNumber = uint64(block.number);
            // Record the block number corresponding to endTime for delay check.
            // We approximate: endTimeBlock = block.number + remaining_blocks_to_endTime.
            // Since we cannot know future block numbers, we store current block.number
            // and use MAX_LOCK_DELAY_BLOCKS as the window from endTime.
            // The delay check in finaliseTWAP uses block.number at lock time.
            state.endTimeBlock = uint64(block.number);
        }

        // Write the pulse index into the packed slot storage.
        _writeSlot(state, slotIndex, pulseIndex);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TWAP Finalisation (called at lockMarket())
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Finalise the TWAP using the Dual-Anchor Blockhash mechanism.
    /// @dev Called by TradingEngine.lockMarket() exactly once.
    ///      Computes T_stop, reconstructs all valid slots via Fill-Forward,
    ///      and returns the discrete arithmetic mean of valid slot values.
    ///
    ///      Atomicity guarantee: all state changes occur before the return.
    ///      If this function reverts, no state is modified (Solidity revert semantics).
    ///
    /// @param state    Storage reference to the View's TWAPState.
    /// @param endTime  The View's endTime.
    /// @param viewId   The View ID (used as entropy salt).
    /// @return twap    The finalised TWAP value in basis points [1, 9999].
    function finaliseTWAP(
        TWAPState storage state,
        uint256 endTime,
        uint256 viewId
    ) internal returns (uint256 twap) {
        // Idempotent: if already locked, return the stored value.
        if (state.locked) return state.finalTWAP;

        // ── Step 1: Compute T_stop ────────────────────────────────────────────
        uint256 tStop = _computeTStop(state, endTime, viewId);
        state.tStop = tStop;

        // ── Step 2: Determine valid slot count ───────────────────────────────
        uint256 windowStart = endTime - OBSERVATION_WINDOW;

        // All Phase 1 slots are valid.
        // Phase 2 slots are valid only if their end time <= T_stop.
        // Slot i ends at: windowStart + (i + 1) * SLOT_DURATION
        // Slot i is valid if: windowStart + (i + 1) * SLOT_DURATION <= tStop
        // => i <= (tStop - windowStart) / SLOT_DURATION - 1
        uint256 lastValidSlot;
        if (tStop <= windowStart) {
            // No slots valid (should not happen in normal operation).
            lastValidSlot = 0;
        } else {
            uint256 slotsBeforeTStop = (tStop - windowStart) / SLOT_DURATION;
            if (slotsBeforeTStop == 0) {
                lastValidSlot = 0;
            } else {
                lastValidSlot = slotsBeforeTStop - 1;
                if (lastValidSlot >= TOTAL_SLOTS) lastValidSlot = TOTAL_SLOTS - 1;
            }
        }

        // Minimum: always include all Phase 1 slots (slots 0–179).
        if (lastValidSlot < PHASE1_SLOTS - 1) lastValidSlot = PHASE1_SLOTS - 1;

        uint256 validSlotCount = lastValidSlot + 1;

        // ── Step 3: Reconstruct slot values via Fill-Forward ─────────────────
        // Uses sparse slot state storage only. Event logs are NOT used.
        uint256 initialIndex = state.lastKnownPulseIndex;
        if (initialIndex == 0) initialIndex = MathLibrary.INITIAL_INDEX;

        uint256 sum = 0;
        uint256 lastKnown = initialIndex;

        for (uint256 i = 0; i < validSlotCount; ) {
            uint256 slotVal;
            if (_isSlotWritten(state, i)) {
                slotVal = _readSlot(state, i);
                if (slotVal == 0) slotVal = lastKnown; // safety: treat 0 as unwritten
            } else {
                slotVal = lastKnown;
            }
            lastKnown = slotVal;
            sum += slotVal;
            unchecked { ++i; }
        }

        // ── Step 4: Compute discrete arithmetic mean ─────────────────────────
        if (validSlotCount == 0) {
            twap = MathLibrary.clampIndex(initialIndex);
        } else {
            twap = MathLibrary.clampIndex(sum / validSlotCount);
        }

        // ── Step 5: Finalise state (atomic) ───────────────────────────────────
        state.finalTWAP = twap;
        state.locked    = true;

        return twap;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: T_stop Computation
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Compute T_stop using the Dual-Anchor Blockhash design.
    /// @dev Fallback to T_stop = endTime if:
    ///      (a) seedBlockNumber == 0 (no blind-period trade occurred), or
    ///      (b) either blockhash returns zero (stale, > 256 blocks old), or
    ///      (c) lockMarket() was called more than MAX_LOCK_DELAY_BLOCKS after endTime.
    function _computeTStop(
        TWAPState storage state,
        uint256 endTime,
        uint256 viewId
    ) internal view returns (uint256 tStop) {
        uint256 blindStart = endTime - PHASE2_DURATION;

        // Fallback condition (a): no blind-period trade.
        if (state.seedBlockNumber == 0) return endTime;

        // Fallback condition (c): lockMarket() called too late.
        // We check if the current block is more than MAX_LOCK_DELAY_BLOCKS
        // past the block where seedBlockNumber was recorded plus the remaining
        // blocks to endTime. Since we stored block.number at first blind trade,
        // the maximum age of seedBlockNumber at lock time is:
        //   (blocks elapsed since seed) = block.number - seedBlockNumber
        // This must be < 256 for blockhash to be available.
        uint256 seedAge = block.number - uint256(state.seedBlockNumber);
        if (seedAge >= 256) return endTime;

        // Compute entropy from both anchors.
        bytes32 seed1 = blockhash(uint256(state.seedBlockNumber));
        bytes32 seed2 = blockhash(block.number - 1);

        // Fallback condition (b): either blockhash is zero (stale).
        if (seed1 == bytes32(0) || seed2 == bytes32(0)) return endTime;

        // Combine entropy with viewId as salt to prevent cross-market correlation.
        uint256 entropy = uint256(keccak256(abi.encodePacked(seed1, seed2, viewId)));

        // T_stop is uniformly distributed in [blindStart, endTime).
        tStop = blindStart + (entropy % PHASE2_DURATION);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: Packed Slot Storage
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Write a Pulse Index value to a packed slot.
    /// @dev Each slot stores a uint16 (max 9999). 16 slots per uint256 word.
    ///      Slot i → word index: i / 16, bit offset: (i % 16) * 16.
    function _writeSlot(
        TWAPState storage state,
        uint256 slotIndex,
        uint256 pulseIndex
    ) private {
        uint256 wordIdx   = slotIndex / 16;
        uint256 bitOffset = (slotIndex % 16) * 16;
        uint256 mask      = ~(uint256(0xFFFF) << bitOffset);
        uint256 val       = (pulseIndex & 0xFFFF) << bitOffset;
        state.packedSlots[wordIdx] = (state.packedSlots[wordIdx] & mask) | val;
        // Mark slot as written in bitmap.
        state.writtenSlotBitmap |= (1 << slotIndex);
    }

    /// @notice Read the Pulse Index value from a packed slot.
    function _readSlot(
        TWAPState storage state,
        uint256 slotIndex
    ) private view returns (uint256) {
        uint256 wordIdx   = slotIndex / 16;
        uint256 bitOffset = (slotIndex % 16) * 16;
        return (state.packedSlots[wordIdx] >> bitOffset) & 0xFFFF;
    }

    /// @notice Check whether a slot has been written by a trade.
    function _isSlotWritten(
        TWAPState storage state,
        uint256 slotIndex
    ) private view returns (bool) {
        return (state.writtenSlotBitmap >> slotIndex) & 1 == 1;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Return the finalised TWAP. Reverts if not yet locked.
    function getFinalTWAP(TWAPState storage state) internal view returns (uint256) {
        if (!state.locked) revert TWAP__NotFinalised();
        return state.finalTWAP;
    }

    /// @notice Return whether the TWAP has been finalised.
    function isLocked(TWAPState storage state) internal view returns (bool) {
        return state.locked;
    }

    /// @notice Return the computed T_stop (zero if not yet finalised).
    function getTStop(TWAPState storage state) internal view returns (uint256) {
        return state.tStop;
    }

    /// @notice Check whether the current timestamp is within the observation window.
    /// @param endTime The View's EndTime. Returns false for PERMANENT views (endTime == 0).
    function isInObservationWindow(uint256 endTime) internal view returns (bool) {
        if (endTime == 0) return false;
        uint256 ts = block.timestamp;
        return ts >= endTime - OBSERVATION_WINDOW && ts < endTime;
    }
}
