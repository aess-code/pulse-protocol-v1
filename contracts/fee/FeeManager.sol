// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IFeeManager }     from "../interfaces/IFeeManager.sol";
import { IPulseFactory }   from "../interfaces/IPulseFactory.sol";
import { IMarketVault }    from "../interfaces/IMarketVault.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FeeManager
/// @notice Protocol fee accounting and distribution module for Pulse Protocol V1.
///
/// @dev ── Architecture Position ─────────────────────────────────────────────
///
///      FeeManager is an **Accounting-Only** module.
///      It NEVER holds ERC20 tokens. All physical fee assets reside in MarketVault.
///
///      Fee Flow:
///        Trade occurs in TradingEngine
///          → TradingEngine calls FeeManager.recordFee() (accounting entry)
///          → FeeManager calls MarketVault.notifyFeeRecorded() (quota registration)
///          → Physical fee tokens remain in MarketVault
///
///      Claim Flow (Pull-over-Push):
///        FeeRecipient/Treasury/Team calls claimXxxFee()
///          → FeeManager zeroes internal ledger (CEI: Effect before Interaction)
///          → FeeManager calls MarketVault.releaseFee() (Vault transfers to recipient)
///
///      Fee Split (fixed per Architecture Constitution, immutable):
///        Total:         1.00% of trade value (100 bps of trade value)
///        FeeRecipient:  70% of total fee (7000 bps of total fee)
///        Treasury:      20% of total fee (2000 bps of total fee)
///        Team:          10% of total fee (1000 bps of total fee)
///
///      BPS Denominator: 10000 (all share constants are expressed in 10000-base BPS)
///
///      ── Security Properties ───────────────────────────────────────────────
///      - Only authorised TradingEngine may call recordFee()
///      - Only the View's FeeRecipient may call claimFeeRecipientFee()
///      - Only the configured treasury address may call claimTreasuryFee()
///      - Only the configured team address may call claimTeamFee()
///      - CEI pattern prevents reentrancy in all claim functions
///      - Vault-layer quota protection prevents over-release even if FeeManager is buggy
///      - FeeRecipient is resolved from the immutable Factory registry; cannot be spoofed
/// @dev Stage 7 RC Hardening: Added ReentrancyGuard as defense-in-depth.
contract FeeManager is IFeeManager, ReentrancyGuard {

    // ─────────────────────────────────────────────────────────────────────────
    // Constants — Fee Split (Fixed per Architecture Constitution)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice BPS denominator. All share constants are expressed in 10000-base BPS.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Total trade fee in basis points. Fixed per protocol: 1.00% of trade value.
    /// @dev This is the gross fee deducted from each trade. It is NOT used in the internal
    ///      split calculation (which uses the 10000-base share constants below).
    uint256 public constant TOTAL_FEE_BPS = 100;

    /// @notice FeeRecipient share: 70% of total fee (7000 bps of 10000).
    uint256 public constant FEE_RECIPIENT_SHARE_BPS = 7_000;

    /// @notice Treasury share: 20% of total fee (2000 bps of 10000).
    uint256 public constant TREASURY_SHARE_BPS = 2_000;

    /// @notice Team share: 10% of total fee (1000 bps of 10000).
    /// @dev Team share is computed as the remainder to absorb integer division dust.
    uint256 public constant TEAM_SHARE_BPS = 1_000;

    // ─────────────────────────────────────────────────────────────────────────
    // Immutable Dependencies
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice The authorised TradingEngine. Only this address may call recordFee().
    address public immutable authorizedTradingEngine;

    /// @notice The PulseFactory registry. Used to look up Vault and FeeRecipient addresses.
    IPulseFactory public immutable factory;

    /// @notice The protocol treasury address. Receives 20% of all fees.
    address public immutable treasury;

    /// @notice The protocol team address. Receives 10% of all fees.
    address public immutable team;

    // ─────────────────────────────────────────────────────────────────────────
    // State Variables
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Pending feeRecipient fee balance per (viewId, feeRecipient).
    /// @dev Keyed by viewId → feeRecipient address → pending amount.
    ///      A single feeRecipient address may be associated with multiple Views.
    mapping(uint256 => mapping(address => uint256)) private _pendingFeeRecipientFees;

    /// @notice Pending treasury fee balance per viewId.
    mapping(uint256 => uint256) private _pendingTreasuryFees;

    /// @notice Pending team fee balance per viewId.
    mapping(uint256 => uint256) private _pendingTeamFees;

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Deploy the FeeManager.
    /// @param _authorizedTradingEngine Address of the authorised TradingEngine.
    /// @param _factory                 Address of the PulseFactory registry.
    /// @param _treasury                Address of the protocol treasury.
    /// @param _team                    Address of the protocol team wallet.
    constructor(
        address _authorizedTradingEngine,
        address _factory,
        address _treasury,
        address _team
    ) {
        if (_authorizedTradingEngine == address(0)) revert FeeManager__UnauthorisedCaller();
        if (_factory                 == address(0)) revert FeeManager__InvalidFeeRecipient();
        if (_treasury                == address(0)) revert FeeManager__InvalidFeeRecipient();
        if (_team                    == address(0)) revert FeeManager__InvalidFeeRecipient();
        authorizedTradingEngine = _authorizedTradingEngine;
        factory                 = IPulseFactory(_factory);
        treasury                = _treasury;
        team                    = _team;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Restricts function to the authorised TradingEngine only.
    modifier onlyTradingEngine() {
        if (msg.sender != authorizedTradingEngine) revert FeeManager__UnauthorisedCaller();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State-Changing Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IFeeManager
    /// @dev Only callable by the authorised TradingEngine.
    ///
    ///      Split formula (10000-base BPS):
    ///        feeRecipientFee = totalFee * 7000 / 10000
    ///        treasuryFee     = totalFee * 2000 / 10000
    ///        teamFee         = totalFee - feeRecipientFee - treasuryFee  (absorbs dust)
    ///
    ///      After updating internal ledgers, notifies the Vault of the new fee obligation
    ///      so the Vault can independently enforce the release quota.
    function recordFee(
        uint256 viewId,
        address feeRecipient,
        uint256 totalFee
    ) external override onlyTradingEngine {
        if (totalFee == 0)             revert FeeManager__ZeroFee();
        if (feeRecipient == address(0)) revert FeeManager__InvalidFeeRecipient();

        // Split fee using 10000-base BPS denominator
        uint256 feeRecipientFee = (totalFee * FEE_RECIPIENT_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 treasuryFee     = (totalFee * TREASURY_SHARE_BPS)      / BPS_DENOMINATOR;
        uint256 teamFee         = totalFee - feeRecipientFee - treasuryFee; // absorbs dust

        // Update internal ledgers
        _pendingFeeRecipientFees[viewId][feeRecipient] += feeRecipientFee;
        _pendingTreasuryFees[viewId]                   += treasuryFee;
        _pendingTeamFees[viewId]                       += teamFee;

        emit FeeRecorded(viewId, feeRecipient, totalFee, feeRecipientFee, treasuryFee, teamFee);

        // Notify Vault of the new fee obligation (enables Vault-layer quota protection).
        address vaultAddr = factory.getVault(viewId);
        if (vaultAddr == address(0)) revert FeeManager__VaultNotFound(viewId);
        IMarketVault(vaultAddr).notifyFeeRecorded(totalFee);
    }

    /// @inheritdoc IFeeManager
    /// @dev Only the FeeRecipient of the View may claim their fee.
    ///      The FeeRecipient address is resolved from the immutable Factory registry.
    ///
    ///      CEI Pattern:
    ///        1. CHECK  — caller is the View's FeeRecipient, pending > 0
    ///        2. EFFECT — zero the pending balance (prevents reentrancy double-claim)
    ///        3. INTERACT — call Vault.releaseFee() to transfer tokens to feeRecipient
    function claimFeeRecipientFee(uint256 viewId) external override nonReentrant {
        // Resolve feeRecipient from Factory (immutable per View)
        IPulseFactory.ViewRecord memory view_ = factory.getView(viewId);
        address feeRecipient = view_.feeRecipient;

        // Only the View's FeeRecipient may claim
        if (msg.sender != feeRecipient) revert FeeManager__UnauthorisedCaller();

        uint256 amount = _pendingFeeRecipientFees[viewId][feeRecipient];
        if (amount == 0) revert FeeManager__NothingToClaim();

        // CEI: zero ledger before external interaction
        _pendingFeeRecipientFees[viewId][feeRecipient] = 0;

        // Release from Vault
        IMarketVault(view_.vault).releaseFee(feeRecipient, amount);

        emit FeeRecipientClaimed(viewId, feeRecipient, amount);
    }

    /// @inheritdoc IFeeManager
    /// @dev Only the configured treasury address may claim.
    ///
    ///      CEI Pattern:
    ///        1. CHECK  — caller is treasury, pending > 0
    ///        2. EFFECT — zero the pending balance
    ///        3. INTERACT — call Vault.releaseFee()
    function claimTreasuryFee(uint256 viewId) external override nonReentrant {
        if (msg.sender != treasury) revert FeeManager__UnauthorisedCaller();

        uint256 amount = _pendingTreasuryFees[viewId];
        if (amount == 0) revert FeeManager__NothingToClaim();

        // CEI: zero ledger before external interaction
        _pendingTreasuryFees[viewId] = 0;

        address vaultAddr = factory.getVault(viewId);
        IMarketVault(vaultAddr).releaseFee(treasury, amount);

        emit TreasuryFeeClaimed(viewId, treasury, amount);
    }

    /// @inheritdoc IFeeManager
    /// @dev Only the configured team address may claim.
    ///
    ///      CEI Pattern:
    ///        1. CHECK  — caller is team, pending > 0
    ///        2. EFFECT — zero the pending balance
    ///        3. INTERACT — call Vault.releaseFee()
    function claimTeamFee(uint256 viewId) external override nonReentrant {
        if (msg.sender != team) revert FeeManager__UnauthorisedCaller();

        uint256 amount = _pendingTeamFees[viewId];
        if (amount == 0) revert FeeManager__NothingToClaim();

        // CEI: zero ledger before external interaction
        _pendingTeamFees[viewId] = 0;

        address vaultAddr = factory.getVault(viewId);
        IMarketVault(vaultAddr).releaseFee(team, amount);

        emit TeamFeeClaimed(viewId, team, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IFeeManager
    function pendingFeeRecipientFees(uint256 viewId, address feeRecipient)
        external
        view
        override
        returns (uint256)
    {
        return _pendingFeeRecipientFees[viewId][feeRecipient];
    }

    /// @inheritdoc IFeeManager
    function pendingTreasuryFees(uint256 viewId)
        external
        view
        override
        returns (uint256)
    {
        return _pendingTreasuryFees[viewId];
    }

    /// @inheritdoc IFeeManager
    function pendingTeamFees(uint256 viewId)
        external
        view
        override
        returns (uint256)
    {
        return _pendingTeamFees[viewId];
    }

    /// @inheritdoc IFeeManager
    /// @dev Returns the fee split configuration in 10000-base BPS.
    ///      feeRecipientBps: 7000 (70% of total fee)
    ///      treasuryBps:     2000 (20% of total fee)
    ///      teamBps:         1000 (10% of total fee)
    ///      totalBps:        100  (1.00% of trade value — gross trade fee)
    function feeConfig()
        external
        pure
        override
        returns (
            uint256 feeRecipientBps,
            uint256 treasuryBps,
            uint256 teamBps,
            uint256 totalBps
        )
    {
        return (FEE_RECIPIENT_SHARE_BPS, TREASURY_SHARE_BPS, TEAM_SHARE_BPS, TOTAL_FEE_BPS);
    }
}
