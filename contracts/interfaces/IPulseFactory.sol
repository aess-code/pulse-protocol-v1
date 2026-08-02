// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IPulseFactory
/// @notice Interface for the Pulse Protocol V1 factory and global Registry.
/// @dev PulseFactory is the sole entry point for creating Views.
///      It maintains the global Registry (Single Source of Truth) for all Views.
///      Factory does not handle trading, pricing, fees, or settlement.
///
///      Creation is atomic: any failure in initialization reverts the entire transaction.
///      Once created, a View's immutable fields (feeRecipient, type, endTime, feeConfig, etc.)
///      cannot be modified. Only the MarketStatus may advance through its lifecycle.
interface IPulseFactory {

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The two supported View types in V1.
    enum ViewType {
        FIXED,      // Has a fixed EndTime; enters Settlement after EndTime
        PERMANENT   // No EndTime; never enters Settlement
    }

    /// @notice Snapshot of the fee configuration at View creation time.
    /// @dev Immutable per View. Upgrades to FeeManager do not affect existing Views.
    struct FeeConfig {
        uint256 totalBps;         // Total fee in basis points (e.g. 100 = 1.00%)
        uint256 feeRecipientBps;  // FeeRecipient share (e.g. 7000 = 70.00% of total fee)
        uint256 treasuryBps;      // Treasury share (e.g. 2000 = 20.00% of total fee)
        uint256 teamBps;          // Team share (e.g. 1000 = 10.00% of total fee)
    }

    /// @notice Complete on-chain record for a registered View.
    /// @dev All fields except `viewId` are immutable after creation.
    ///      This record is the single source of truth for a View's economic rules.
    struct ViewRecord {
        uint256    viewId;
        address    feeRecipient;          // Address receiving 70% of all trading fees. Immutable.
        ViewType   viewType;
        string     metadataURI;
        bytes32    metadataHash;
        uint256    createdAt;
        uint256    startTime;
        uint256    endTime;               // 0 for PERMANENT views
        address    vault;                 // Address of the View's MarketVault
        address    priceEngine;           // Immutable PriceEngine version snapshot at creation
        address    settlementManager;     // Immutable SettlementManager snapshot at creation
        FeeConfig  feeConfig;             // Immutable fee snapshot at creation
    }

    /// @notice Per-user liquidity contribution for initial market allocation.
    /// @dev Used by External Modules (e.g. GE, DAO Launchpad) when calling
    ///      createViewWithInitialAllocation(). Core computes Position Shares
    ///      internally from these USDT amounts. External Modules must never
    ///      compute shares themselves to remain decoupled from Core math.
    struct LiquidityAllocation {
        address user;           // Recipient of the initial Position Shares
        uint256 yesLiquidity;   // USDT amount allocated to the YES (For) side
        uint256 noLiquidity;    // USDT amount allocated to the NO (Against) side
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Emitted when a new View is successfully created and registered.
    /// @param viewId        Unique identifier assigned to the View.
    /// @param feeRecipient  Address designated to receive 70% of all trading fees.
    /// @param viewType      FIXED or PERMANENT.
    /// @param vault         Address of the newly deployed MarketVault.
    /// @param endTime       EndTime for FIXED views; 0 for PERMANENT views.
    event ViewCreated(
        uint256 indexed viewId,
        address indexed feeRecipient,
        ViewType        viewType,
        address         vault,
        uint256         endTime
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Custom Errors
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Thrown when the feeRecipient address is the zero address.
    error Factory__InvalidFeeRecipient();

    /// @notice Thrown when the metadataURI is empty.
    error Factory__InvalidMetadata();

    /// @notice Thrown when the ViewType is not a valid enum value.
    error Factory__InvalidViewType();

    /// @notice Thrown when endTime <= startTime for a FIXED view, or when the
    ///         total duration is less than SETTLEMENT_WINDOW + MIN_TRADING_DURATION.
    ///         Minimum required: endTime >= startTime + 30 minutes + 30 minutes = 1 hour.
    error Factory__InvalidTimeRange();

    /// @notice Thrown when the market duration is too short to guarantee a valid settlement window.
    ///         endTime must be at least startTime + SETTLEMENT_WINDOW + MIN_TRADING_DURATION.
    error Factory__DurationTooShort();

    /// @notice Thrown when endTime is non-zero for a PERMANENT view.
    error Factory__PermanentViewMustHaveZeroEndTime();

    /// @notice Thrown when a required module address (engine, settlement, etc.) is zero.
    error Factory__InvalidModuleAddress();

    /// @notice Thrown when the Vault deployment fails.
    error Factory__VaultDeploymentFailed();

    /// @notice Thrown when querying a ViewID that does not exist.
    error Factory__ViewNotFound(uint256 viewId);

    /// @notice Thrown when the total initial liquidity is below the protocol minimum.
    error Factory__InsufficientInitialLiquidity(uint256 provided, uint256 minimum);

    /// @notice Thrown when the LiquidityAllocation array is empty.
    error Factory__EmptyAllocation();

    /// @notice Thrown when the sum of allocation amounts does not match the declared totals.
    error Factory__AllocationMismatch();

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Create a new View and register it in the protocol Registry.
    /// @dev For direct use by EOA users. feeRecipient is automatically set to msg.sender.
    ///      Atomically: validates parameters, generates ViewID, deploys MarketVault,
    ///      registers the View, initialises MarketState, and emits ViewCreated.
    ///      Any failure reverts entirely.
    ///
    ///      Minimum Duration Constraint (Stage 4.5 Hardening):
    ///        For FIXED views, endTime must satisfy:
    ///          endTime >= startTime + SETTLEMENT_WINDOW + MIN_TRADING_DURATION
    ///        where SETTLEMENT_WINDOW = 30 minutes and MIN_TRADING_DURATION = 30 minutes.
    ///
    /// @param viewType             FIXED or PERMANENT.
    /// @param metadataURI          URI pointing to off-chain metadata (IPFS/Arweave recommended).
    /// @param metadataHash         Keccak256 hash of the metadata for on-chain integrity verification.
    /// @param startTime            Unix timestamp when trading opens.
    /// @param endTime              Unix timestamp when trading closes. Must be 0 for PERMANENT views.
    /// @param initialYesLiquidity  USDT amount for the YES (For) initial liquidity.
    /// @param initialNoLiquidity   USDT amount for the NO (Against) initial liquidity.
    /// @return viewId              The unique ViewID assigned to the new View.
    function createView(
        ViewType viewType,
        string  calldata metadataURI,
        bytes32          metadataHash,
        uint256          startTime,
        uint256          endTime,
        uint256          initialYesLiquidity,
        uint256          initialNoLiquidity
    ) external returns (uint256 viewId);

    /// @notice Create a new View with initial liquidity distributed to multiple participants.
    /// @dev For use by External Modules (e.g. GE, DAO Launchpad). Allows specifying a
    ///      feeRecipient address distinct from msg.sender. Core computes YES/NO Position
    ///      Shares from each user's USDT contribution and writes them directly to each
    ///      user's position in TradingEngine — no custodial intermediary.
    ///
    ///      Core validates:
    ///        - totalYesLiquidity + totalNoLiquidity >= MIN_INITIAL_LIQUIDITY
    ///        - sum(alloc.yesLiquidity) == totalYesLiquidity
    ///        - sum(alloc.noLiquidity)  == totalNoLiquidity
    ///        - allocations.length > 0
    ///        - no user == address(0)
    ///        - no (yesLiquidity == 0 && noLiquidity == 0) per entry
    ///
    ///      Core does NOT validate any application-layer rules (e.g. minimum deposit requirements,
    ///      50/50 split requirements). Those are the responsibility of the External Module.
    ///
    /// @param viewType             FIXED or PERMANENT.
    /// @param metadataURI          URI pointing to off-chain metadata.
    /// @param metadataHash         Keccak256 hash of the metadata.
    /// @param startTime            Unix timestamp when trading opens.
    /// @param endTime              Unix timestamp when trading closes. Must be 0 for PERMANENT views.
    /// @param feeRecipient         Address to receive 70% of all trading fees for this View.
    /// @param totalYesLiquidity    Total YES-side USDT to deposit.
    /// @param totalNoLiquidity     Total NO-side USDT to deposit.
    /// @param allocations          Per-user USDT contribution breakdown.
    /// @return viewId              The unique ViewID assigned to the new View.
    function createViewWithInitialAllocation(
        ViewType viewType,
        string  calldata metadataURI,
        bytes32          metadataHash,
        uint256          startTime,
        uint256          endTime,
        address          feeRecipient,
        uint256          totalYesLiquidity,
        uint256          totalNoLiquidity,
        LiquidityAllocation[] calldata allocations
    ) external returns (uint256 viewId);

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Returns the complete ViewRecord for a given ViewID.
    /// @param viewId The ViewID to query.
    function getView(uint256 viewId) external view returns (ViewRecord memory);

    /// @notice Returns whether a ViewID exists in the Registry.
    /// @param viewId The ViewID to check.
    function exists(uint256 viewId) external view returns (bool);

    /// @notice Returns the Vault address for a given ViewID.
    /// @param viewId The ViewID to query.
    function getVault(uint256 viewId) external view returns (address vault);

    /// @notice Returns the FeeConfig snapshot for a given ViewID.
    /// @dev Used by FeeManager to apply the correct fee rates for a View.
    /// @param viewId The ViewID to query.
    function getFeeConfig(uint256 viewId) external view returns (FeeConfig memory);

    /// @notice Returns all ViewIDs associated with a specific FeeRecipient address.
    /// @param feeRecipient Address of the FeeRecipient.
    function getFeeRecipientViews(address feeRecipient) external view returns (uint256[] memory viewIds);

    /// @notice Returns the total number of Views ever created.
    function totalViews() external view returns (uint256);

    /// @notice Returns the total number of unique FeeRecipient addresses registered.
    function totalFeeRecipients() external view returns (uint256);
}
