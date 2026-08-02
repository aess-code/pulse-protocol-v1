// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IFeeManager
/// @notice Interface for the protocol fee accounting and distribution module.
/// @dev Implements a Pull-over-Push model. TradingEngine records fee obligations
///      during trades; no active transfers occur at trade time. FeeRecipient, Treasury,
///      and Team must call their respective claim functions to withdraw accumulated balances.
///
///      Fee structure (fixed per protocol V1 rules, immutable):
///        Total:         1.00%  (100 bps of trade value)
///        FeeRecipient:  0.70%  (7000 bps = 70% of total fee)
///        Treasury:      0.20%  (2000 bps = 20% of total fee)
///        Team:          0.10%  (1000 bps = 10% of total fee)
interface IFeeManager {

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Emitted when a fee is recorded during a trade.
    /// @param viewId           The ViewID the fee originated from.
    /// @param feeRecipient     The FeeRecipient of the View receiving the feeRecipient share.
    /// @param totalFee         Total fee amount collected from the trade.
    /// @param feeRecipientFee  FeeRecipient's share of the fee.
    /// @param treasuryFee      Treasury's share of the fee.
    /// @param teamFee          Team's share of the fee.
    event FeeRecorded(
        uint256 indexed viewId,
        address indexed feeRecipient,
        uint256 totalFee,
        uint256 feeRecipientFee,
        uint256 treasuryFee,
        uint256 teamFee
    );

    /// @notice Emitted when a FeeRecipient claims their accumulated fees.
    /// @param viewId        The ViewID the fee belongs to.
    /// @param feeRecipient  Address of the FeeRecipient.
    /// @param amount        Amount of settlement token claimed.
    event FeeRecipientClaimed(uint256 indexed viewId, address indexed feeRecipient, uint256 amount);

    /// @notice Emitted when the Treasury claims accumulated fees.
    /// @param viewId    The ViewID the fee belongs to.
    /// @param treasury  Address of the Treasury.
    /// @param amount    Amount of settlement token claimed.
    event TreasuryFeeClaimed(uint256 indexed viewId, address indexed treasury, uint256 amount);

    /// @notice Emitted when the Team claims accumulated fees.
    /// @param viewId  The ViewID the fee belongs to.
    /// @param team    Address of the Team wallet.
    /// @param amount  Amount of settlement token claimed.
    event TeamFeeClaimed(uint256 indexed viewId, address indexed team, uint256 amount);

    // ─────────────────────────────────────────────────────────────────────────
    // Custom Errors
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Thrown when the caller is not the authorised TradingEngine.
    error FeeManager__UnauthorisedCaller();

    /// @notice Thrown when the fee amount is zero.
    error FeeManager__ZeroFee();

    /// @notice Thrown when there are no fees available to claim.
    error FeeManager__NothingToClaim();

    /// @notice Thrown when the feeRecipient address is the zero address.
    error FeeManager__InvalidFeeRecipient();

    /// @notice Thrown when the Vault address for a ViewID is not found.
    error FeeManager__VaultNotFound(uint256 viewId);

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Record a fee obligation arising from a trade.
    /// @dev Only callable by the authorised TradingEngine.
    ///      Splits `totalFee` into feeRecipient/treasury/team shares and updates
    ///      internal pending balances. No token transfer occurs.
    /// @param viewId        The ViewID the trade occurred in.
    /// @param feeRecipient  Address of the View's FeeRecipient.
    /// @param totalFee      Total fee amount (1% of trade value) in settlement tokens.
    function recordFee(
        uint256 viewId,
        address feeRecipient,
        uint256 totalFee
    ) external;

    /// @notice FeeRecipient withdraws their accumulated fee balance for a specific View.
    /// @dev Uses Checks-Effects-Interactions: balance set to zero before transfer.
    ///      Only the feeRecipient of `viewId` may call this.
    /// @param viewId The ViewID to claim fees from.
    function claimFeeRecipientFee(uint256 viewId) external;

    /// @notice Treasury address withdraws its accumulated fee balance for a specific View.
    /// @dev Only callable by the configured treasury address.
    /// @param viewId The ViewID to claim fees from.
    function claimTreasuryFee(uint256 viewId) external;

    /// @notice Team address withdraws its accumulated fee balance for a specific View.
    /// @dev Only callable by the configured team address.
    /// @param viewId The ViewID to claim fees from.
    function claimTeamFee(uint256 viewId) external;

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Returns the pending claimable feeRecipient fee balance for a specific View.
    /// @param viewId        The ViewID to query.
    /// @param feeRecipient  Address of the FeeRecipient.
    function pendingFeeRecipientFees(uint256 viewId, address feeRecipient) external view returns (uint256);

    /// @notice Returns the pending claimable treasury fee balance for a specific View.
    /// @param viewId The ViewID to query.
    function pendingTreasuryFees(uint256 viewId) external view returns (uint256);

    /// @notice Returns the pending claimable team fee balance for a specific View.
    /// @param viewId The ViewID to query.
    function pendingTeamFees(uint256 viewId) external view returns (uint256);

    /// @notice Returns the fee split configuration in basis points.
    /// @return feeRecipientBps  FeeRecipient share in basis points (7000 = 70% of total fee).
    /// @return treasuryBps      Treasury share in basis points (2000 = 20% of total fee).
    /// @return teamBps          Team share in basis points (1000 = 10% of total fee).
    /// @return totalBps         Total fee in basis points (e.g. 100 = 1.00% of trade value).
    function feeConfig()
        external
        view
        returns (
            uint256 feeRecipientBps,
            uint256 treasuryBps,
            uint256 teamBps,
            uint256 totalBps
        );
}
