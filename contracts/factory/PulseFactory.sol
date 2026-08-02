// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IPulseFactory }       from "../interfaces/IPulseFactory.sol";
import { IMarketVaultFactory } from "../interfaces/IMarketVaultFactory.sol";
import { IMarketVault }        from "../interfaces/IMarketVault.sol";
import { ITradingEngine }      from "../interfaces/ITradingEngine.sol";
import { IERC20 }              from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 }           from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title PulseFactory
/// @notice The sole entry point for creating Views in Pulse Protocol V1.
///
/// @dev ── Architecture Position ─────────────────────────────────────────────
///
///      PulseFactory is the **Registry and Deployment** module.
///      It maintains the global registry (Single Source of Truth) for all Views.
///
///      View Creation Flow (atomic):
///        1. Validate parameters (feeRecipient, metadata, time, minimum liquidity)
///        2. Generate ViewID (auto-incrementing)
///        3. Deploy MarketVault via MarketVaultFactory
///        4. Call MarketVault.setFeeManager() to register FeeManager authorization
///        5. Register ViewRecord in the global registry
///        6. Transfer initial liquidity from caller directly to Vault (one-step, no custody)
///        7. Call TradingEngine.initializeMarketState() to set up Shares and Positions
///        8. Emit ViewCreated
///
///      Invariants:
///        - One View = One Vault (enforced by MarketVaultFactory)
///        - ViewRecord fields are immutable after creation
///        - ViewID is globally unique and monotonically increasing
///        - Factory never holds, approves, or re-transfers tokens
///        - Factory never computes Shares (all math is in TradingEngine)
///
///      ── Time Constraints (Stage 4.5 Hardening) ────────────────────────────
///      For FIXED views:
///        endTime >= startTime + SETTLEMENT_WINDOW + MIN_TRADING_DURATION
///        where SETTLEMENT_WINDOW = 60 minutes (Stage 6.6), MIN_TRADING_DURATION = 30 minutes
///        Minimum total duration: 90 minutes
contract PulseFactory is IPulseFactory {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Duration of the observation window (last 60 minutes before EndTime).
    /// @dev Stage 6.6: Updated from 30 minutes to 60 minutes to accommodate the
    ///      Dynamic Fixed-Slot Random-Cutoff Discrete TWAP observation window.
    ///      This constant is used ONLY for new market creation validation.
    ///      It does NOT affect already-created markets or their settlement behaviour.
    uint256 public constant SETTLEMENT_WINDOW     = 60 minutes;

    /// @notice Minimum active trading duration before the settlement window.
    uint256 public constant MIN_TRADING_DURATION  = 30 minutes;

    /// @notice Minimum total market duration for FIXED views.
    uint256 public constant MIN_MARKET_DURATION   = SETTLEMENT_WINDOW + MIN_TRADING_DURATION;

    // ─────────────────────────────────────────────────────────────────────────
    // Immutable Dependencies
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The MarketVaultFactory used to deploy per-View Vaults.
    IMarketVaultFactory public immutable vaultFactory;

    /// @notice The shared TradingEngine. Registered as the authorised engine in each Vault.
    address public immutable tradingEngine;

    /// @notice The shared SettlementManager. Registered as the authorised settlement in each Vault.
    address public immutable settlementManager;

    /// @notice The shared FeeManager. Registered as the authorised FeeManager in each Vault.
    address public immutable feeManager;

    /// @notice The settlement token (ERC20) used for all Views.
    address public immutable settlementToken;

    /// @notice Minimum total initial liquidity (YES + NO) required to create a View.
    /// @dev Expressed in settlement token units (e.g. 100 * 10^6 for 100 USDT with 6 decimals).
    ///      Validated by Factory before Vault deployment. TradingEngine does not re-check this.
    uint256 public immutable MIN_INITIAL_LIQUIDITY;

    // ─────────────────────────────────────────────────────────────────────────
    // State Variables
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Auto-incrementing ViewID counter. Starts at 1.
    uint256 private _nextViewId;

    /// @notice Global registry: ViewID → ViewRecord.
    mapping(uint256 => ViewRecord) private _views;

    /// @notice Tracks which ViewIDs exist.
    mapping(uint256 => bool) private _exists;

    /// @notice FeeRecipient → list of ViewIDs associated with this FeeRecipient.
    mapping(address => uint256[]) private _feeRecipientViews;

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Deploy the PulseFactory.
    /// @param _vaultFactory         Address of the MarketVaultFactory.
    /// @param _tradingEngine        Address of the shared TradingEngine.
    /// @param _settlementManager    Address of the shared SettlementManager.
    /// @param _feeManager           Address of the shared FeeManager.
    /// @param _settlementToken      Address of the ERC20 settlement token.
    /// @param _minInitialLiquidity  Minimum total initial liquidity (YES + NO) in token units.
    constructor(
        address _vaultFactory,
        address _tradingEngine,
        address _settlementManager,
        address _feeManager,
        address _settlementToken,
        uint256 _minInitialLiquidity
    ) {
        if (_vaultFactory      == address(0)) revert Factory__InvalidModuleAddress();
        if (_tradingEngine     == address(0)) revert Factory__InvalidModuleAddress();
        if (_settlementManager == address(0)) revert Factory__InvalidModuleAddress();
        if (_feeManager        == address(0)) revert Factory__InvalidModuleAddress();
        if (_settlementToken   == address(0)) revert Factory__InvalidModuleAddress();

        vaultFactory          = IMarketVaultFactory(_vaultFactory);
        tradingEngine         = _tradingEngine;
        settlementManager     = _settlementManager;
        feeManager            = _feeManager;
        settlementToken       = _settlementToken;
        MIN_INITIAL_LIQUIDITY = _minInitialLiquidity;

        _nextViewId = 1; // ViewIDs start at 1
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IPulseFactory
    /// @dev Wrapper for direct EOA use. Automatically sets feeRecipient = msg.sender
    ///      and constructs a single-element LiquidityAllocation before routing to
    ///      _createViewInternal(). No independent creation logic exists here.
    function createView(
        ViewType viewType,
        string  calldata metadataURI,
        bytes32          metadataHash,
        uint256          startTime,
        uint256          endTime,
        uint256          initialYesLiquidity,
        uint256          initialNoLiquidity
    ) external override returns (uint256 viewId) {
        LiquidityAllocation[] memory allocs = new LiquidityAllocation[](1);
        allocs[0] = LiquidityAllocation({
            user:         msg.sender,
            yesLiquidity: initialYesLiquidity,
            noLiquidity:  initialNoLiquidity
        });

        return _createViewInternal(
            viewType,
            metadataURI,
            metadataHash,
            startTime,
            endTime,
            msg.sender, // feeRecipient is always the caller for the simple entry point
            initialYesLiquidity,
            initialNoLiquidity,
            allocs
        );
    }

    /// @inheritdoc IPulseFactory
    /// @dev For use by External Modules (e.g. GE, DAO Launchpad). Allows specifying
    ///      a feeRecipient and a multi-participant LiquidityAllocation array.
    ///      All Allocation validation is performed inside TradingEngine.initializeMarketState().
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
    ) external override returns (uint256 viewId) {
        return _createViewInternal(
            viewType,
            metadataURI,
            metadataHash,
            startTime,
            endTime,
            feeRecipient,
            totalYesLiquidity,
            totalNoLiquidity,
            allocations
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IPulseFactory
    function getView(uint256 viewId) external view override returns (ViewRecord memory) {
        if (!_exists[viewId]) revert Factory__ViewNotFound(viewId);
        return _views[viewId];
    }

    /// @inheritdoc IPulseFactory
    function exists(uint256 viewId) external view override returns (bool) {
        return _exists[viewId];
    }

    /// @inheritdoc IPulseFactory
    function getVault(uint256 viewId) external view override returns (address vault) {
        if (!_exists[viewId]) return address(0);
        return _views[viewId].vault;
    }

    /// @inheritdoc IPulseFactory
    function getFeeConfig(uint256 viewId) external view override returns (FeeConfig memory) {
        if (!_exists[viewId]) revert Factory__ViewNotFound(viewId);
        return _views[viewId].feeConfig;
    }

    /// @inheritdoc IPulseFactory
    function getFeeRecipientViews(address feeRecipient)
        external
        view
        override
        returns (uint256[] memory viewIds)
    {
        return _feeRecipientViews[feeRecipient];
    }

    /// @inheritdoc IPulseFactory
    function totalViews() external view override returns (uint256) {
        return _nextViewId - 1;
    }

    /// @inheritdoc IPulseFactory
    function totalFeeRecipients() external pure override returns (uint256) {
        // FeeRecipient count is not tracked to avoid unnecessary storage overhead.
        // This function is retained for interface compatibility and returns 0.
        return 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal Implementation
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Core internal implementation for all View creation paths.
    /// @dev Both createView() and createViewWithInitialAllocation() route here.
    ///      This is the single source of truth for the creation logic.
    ///
    ///      Execution order:
    ///        1. Validate: feeRecipient, metadata, viewType, time constraints, min liquidity
    ///        2. Assign ViewID
    ///        3. Deploy MarketVault
    ///        4. Register FeeManager on Vault
    ///        5. Register ViewRecord
    ///        6. Transfer total liquidity from msg.sender directly to Vault (no custody)
    ///        7. Call TradingEngine.initializeMarketState() (Allocation validation + Shares + Positions)
    ///        8. Emit ViewCreated
    ///
    ///      Atomicity: if step 7 reverts, the entire transaction reverts including step 6.
    ///      Factory never holds tokens at any point.
    function _createViewInternal(
        ViewType viewType,
        string  memory  metadataURI,
        bytes32         metadataHash,
        uint256         startTime,
        uint256         endTime,
        address         feeRecipient,
        uint256         totalYesLiquidity,
        uint256         totalNoLiquidity,
        LiquidityAllocation[] memory allocations
    ) internal returns (uint256 viewId) {
        // ── Checks ────────────────────────────────────────────────────────────

        if (feeRecipient == address(0))       revert Factory__InvalidFeeRecipient();
        if (bytes(metadataURI).length == 0)   revert Factory__InvalidMetadata();
        if (uint256(viewType) > 1)            revert Factory__InvalidViewType();

        // Validate time parameters
        if (startTime == 0) startTime = block.timestamp;

        if (viewType == ViewType.FIXED) {
            if (endTime == 0 || endTime <= startTime) revert Factory__InvalidTimeRange();
            if (endTime < startTime + MIN_MARKET_DURATION) revert Factory__DurationTooShort();
        } else {
            if (endTime != 0) revert Factory__PermanentViewMustHaveZeroEndTime();
        }

        // Validate minimum initial liquidity (YES + NO total)
        uint256 totalLiquidity = totalYesLiquidity + totalNoLiquidity;
        if (totalLiquidity < MIN_INITIAL_LIQUIDITY) {
            revert Factory__InsufficientInitialLiquidity(totalLiquidity, MIN_INITIAL_LIQUIDITY);
        }

        // ── Effects ───────────────────────────────────────────────────────────

        viewId = _nextViewId++;

        // ── Interactions ──────────────────────────────────────────────────────

        // Deploy MarketVault for this View
        address vault = vaultFactory.deployVault(
            viewId,
            tradingEngine,
            settlementManager,
            settlementToken
        );
        if (vault == address(0)) revert Factory__VaultDeploymentFailed();

        // Register FeeManager as authorized on the Vault
        IMarketVault(vault).setFeeManager(feeManager);

        // Register ViewRecord (immutable after this point)
        _views[viewId] = ViewRecord({
            viewId:            viewId,
            feeRecipient:      feeRecipient,
            viewType:          viewType,
            metadataURI:       metadataURI,
            metadataHash:      metadataHash,
            createdAt:         block.timestamp,
            startTime:         startTime,
            endTime:           endTime,
            vault:             vault,
            priceEngine:       address(ITradingEngine(tradingEngine).priceEngine()),
            settlementManager: settlementManager,
            feeConfig:         FeeConfig({
                totalBps:        100,
                feeRecipientBps: 7000,
                treasuryBps:     2000,
                teamBps:         1000
            })
        });
        _exists[viewId] = true;

        // Track FeeRecipient → ViewID association
        _feeRecipientViews[feeRecipient].push(viewId);

        // Transfer total liquidity from caller directly to Vault (one-step, no custody)
        // Factory never holds tokens. If initializeMarketState() reverts below,
        // the entire transaction reverts and this transfer is also rolled back.
        if (totalLiquidity > 0) {
            IERC20(settlementToken).safeTransferFrom(msg.sender, vault, totalLiquidity);
        }

        // Initialize MarketState and distribute Position Shares via TradingEngine.
        // All Allocation validation (non-empty, no zero address, no double-zero, sum check)
        // is performed inside initializeMarketState(). Factory does not re-validate.
        // All Share computation (shares = liquidity * 2) is performed inside TradingEngine.
        // Factory does not perform any mathematical operations.
        ITradingEngine(tradingEngine).initializeMarketState(
            viewId,
            totalYesLiquidity,
            totalNoLiquidity,
            allocations
        );

        emit ViewCreated(viewId, feeRecipient, viewType, vault, endTime);
    }
}
