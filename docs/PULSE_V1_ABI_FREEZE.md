# Pulse V1 ABI Freeze Record

**Frozen Baseline:** `be73488`
**Status:** FINAL RC FREEZE

This document serves as the immutable record of the Pulse Protocol V1 Core ABI. Any change to the signatures, events, or errors listed below constitutes a breaking change and requires a new protocol version.

---

## 1. PulseFactory

**Events:**
- `ViewCreated(uint256 indexed viewId, address indexed feeRecipient, ViewType viewType, address vault, uint256 endTime)`

**Errors:**
- `Factory__InvalidFeeRecipient()`
- `Factory__InvalidMetadata()`
- `Factory__InvalidViewType()`
- `Factory__InvalidTimeRange()`
- `Factory__DurationTooShort()`
- `Factory__PermanentViewMustHaveZeroEndTime()`
- `Factory__InvalidModuleAddress()`
- `Factory__VaultDeploymentFailed()`
- `Factory__ViewNotFound(uint256 viewId)`
- `Factory__InsufficientInitialLiquidity(uint256 provided, uint256 minimum)`
- `Factory__EmptyAllocation()`
- `Factory__AllocationMismatch()`

**External Functions:**
- `createView(ViewType viewType, string calldata metadataURI, bytes32 metadataHash, uint256 startTime, uint256 endTime, uint256 initialYesLiquidity, uint256 initialNoLiquidity) external returns (uint256 viewId)`
- `createViewWithInitialAllocation(ViewType viewType, string calldata metadataURI, bytes32 metadataHash, uint256 startTime, uint256 endTime, address feeRecipient, uint256 totalYesLiquidity, uint256 totalNoLiquidity, LiquidityAllocation[] calldata allocations) external returns (uint256 viewId)`
- `getView(uint256 viewId) external view returns (ViewRecord memory)`
- `exists(uint256 viewId) external view returns (bool)`
- `getVault(uint256 viewId) external view returns (address vault)`
- `getFeeConfig(uint256 viewId) external view returns (FeeConfig memory)`
- `getFeeRecipientViews(address feeRecipient) external view returns (uint256[] memory viewIds)`
- `totalViews() external view returns (uint256)`
- `totalFeeRecipients() external view returns (uint256)`

---

## 2. TradingEngine

**Events:**
- `Bought(uint256 indexed viewId, address indexed trader, uint256 side, uint256 amountIn, uint256 sharesOut, uint256 newIndex)`
- `Sold(uint256 indexed viewId, address indexed trader, uint256 side, uint256 sharesIn, uint256 amountOut, uint256 newIndex)`
- `PulseIndexUpdated(uint256 indexed viewId, uint256 newIndex)`
- `TWAPSnapshotRecorded(uint256 indexed viewId, uint256 pulseIndex, uint256 timestamp)`
- `MarketLocked(uint256 indexed viewId, uint256 finalTWAP, uint256 timestamp)`
- `TWAPFinalised(uint256 indexed viewId, uint256 finalTWAP)`
- `MarketStatusChanged(uint256 indexed viewId, MarketStatus oldStatus, MarketStatus newStatus)`

**Errors:**
- `TradingEngine__MarketNotActive(uint256 viewId, MarketStatus current)`
- `TradingEngine__InvalidStatus(uint256 viewId, MarketStatus current)`
- `TradingEngine__ZeroAmount()`
- `TradingEngine__InvalidSide()`
- `TradingEngine__InsufficientPosition(uint256 viewId, address user, uint256 side, uint256 balance, uint256 requested)`
- `TradingEngine__EndTimeNotReached(uint256 viewId, uint256 currentTime, uint256 endTime)`
- `TradingEngine__AlreadyLocked(uint256 viewId)`
- `TradingEngine__UnauthorisedSettlement()`
- `TradingEngine__ViewNotFound(uint256 viewId)`
- `TradingEngine__ZeroAddress()`
- `TradingEngine__VaultNotFound(uint256 viewId)`
- `TradingEngine__NotImplemented()`
- `TradingEngine__AlreadyInitialised(uint256 viewId)`
- `TradingEngine__UnauthorisedFactory()`
- `TradingEngine__InsufficientInitialLiquidity(uint256 provided, uint256 minimum)`
- `TradingEngine__EmptyAllocation()`
- `TradingEngine__AllocationMismatch()`
- `TradingEngine__InvalidAllocationUser()`
- `TradingEngine__InvalidPriceEngineOutput(uint256 viewId)`
- `TradingEngine__InvalidReserveBalance(uint256 viewId, uint256 reserve)`
- `TradingEngine__SlippageExceeded(uint256 actual, uint256 minimum)`

**External Functions:**
- `initializeMarketState(uint256 viewId, uint256 totalYesLiquidity, uint256 totalNoLiquidity, IPulseFactory.LiquidityAllocation[] calldata allocations) external`
- `buy(uint256 viewId, uint256 side, uint256 amountIn, uint256 minSharesOut) external returns (uint256 sharesOut)`
- `sell(uint256 viewId, uint256 side, uint256 sharesIn, uint256 minAmountOut) external returns (uint256 amountOut)`
- `lockMarket(uint256 viewId) external`
- `setStatusClaimable(uint256 viewId) external`
- `setStatusSettlement(uint256 viewId) external`
- `markPositionClaimed(uint256 viewId, address user) external`
- `getMarketState(uint256 viewId) external view returns (MarketState memory state)`
- `getMarketStatus(uint256 viewId) external view returns (MarketStatus)`
- `getPulseIndex(uint256 viewId) external view returns (uint256 pulseIndex)`
- `getReserve(uint256 viewId) external view returns (uint256 reserve)`
- `getSupply(uint256 viewId) external view returns (uint256 forSupply, uint256 againstSupply)`
- `getPosition(uint256 viewId, address user) external view returns (Position memory position)`
- `getFinalTWAP(uint256 viewId) external view returns (uint256 twap)`
- `getVaultBalance(uint256 viewId) external view returns (uint256)`
- `priceEngine() external view returns (IPriceEngine)`

---

## 3. PriceEngine

**Errors:**
- `PriceEngine__ZeroAmount()`
- `PriceEngine__InvalidSide()`
- `PriceEngine__SolvencyViolation()`
- `PriceEngine__InsufficientSupply()`

**External Functions:**
- `quoteBuy(uint256 forSupply, uint256 againstSupply, uint256 reserveBalance, uint256 side, uint256 amountIn) external pure returns (uint256 sharesOut, uint256 newPulseIndex, uint256 newReserveBalance)`
- `quoteSell(uint256 forSupply, uint256 againstSupply, uint256 reserveBalance, uint256 side, uint256 sharesIn) external pure returns (uint256 amountOut, uint256 newPulseIndex, uint256 newReserveBalance)`
- `currentIndex(uint256 forSupply, uint256 againstSupply) external pure returns (uint256 pulseIndex)`

---

## 4. FeeManager

**Events:**
- `FeeRecorded(uint256 indexed viewId, address indexed feeRecipient, uint256 totalFee, uint256 feeRecipientFee, uint256 treasuryFee, uint256 teamFee)`
- `FeeRecipientClaimed(uint256 indexed viewId, address indexed feeRecipient, uint256 amount)`
- `TreasuryFeeClaimed(uint256 indexed viewId, address indexed treasury, uint256 amount)`
- `TeamFeeClaimed(uint256 indexed viewId, address indexed team, uint256 amount)`

**Errors:**
- `FeeManager__UnauthorisedCaller()`
- `FeeManager__ZeroFee()`
- `FeeManager__NothingToClaim()`
- `FeeManager__InvalidFeeRecipient()`
- `FeeManager__VaultNotFound(uint256 viewId)`

**External Functions:**
- `recordFee(uint256 viewId, address feeRecipient, uint256 totalFee) external`
- `claimFeeRecipientFee(uint256 viewId) external`
- `claimTreasuryFee(uint256 viewId) external`
- `claimTeamFee(uint256 viewId) external`
- `pendingFeeRecipientFees(uint256 viewId, address feeRecipient) external view returns (uint256)`
- `pendingTreasuryFees(uint256 viewId) external view returns (uint256)`
- `pendingTeamFees(uint256 viewId) external view returns (uint256)`
- `feeConfig() external view returns (uint256 feeRecipientBps, uint256 treasuryBps, uint256 teamBps, uint256 totalBps)`

---

## 5. SettlementManager

**Events:**
- `MarketSettled(uint256 indexed viewId, SettlementResult result, uint256 finalTWAP)`
- `RewardClaimed(uint256 indexed viewId, address indexed user, uint256 amount)`

**Errors:**
- `Settlement__MarketNotLocked(uint256 viewId)`
- `Settlement__MarketNotClaimable(uint256 viewId)`
- `Settlement__AlreadySettled(uint256 viewId)`
- `Settlement__AlreadyClaimed(uint256 viewId, address user)`
- `Settlement__NoPositionToClaim(uint256 viewId, address user)`
- `Settlement__InvalidTWAP(uint256 viewId)`
- `Settlement__ZeroAddress()`

**External Functions:**
- `settleMarket(uint256 viewId) external`
- `claimReward(uint256 viewId, address user) external`
- `getSettlementResult(uint256 viewId) external view returns (SettlementResult)`
- `hasClaimed(uint256 viewId, address user) external view returns (bool)`
- `getClaimableAmount(uint256 viewId, address user) external view returns (uint256 amount)`

---

## 6. MarketVaultFactory & MarketVault

**Events (Factory):**
- `VaultDeployed(uint256 indexed viewId, address indexed vault, address indexed token)`

**Errors (Factory):**
- `VaultFactory__Unauthorised()`
- `VaultFactory__AlreadyDeployed(uint256 viewId)`
- `VaultFactory__ZeroAddress()`

**External Functions (Factory):**
- `deployVault(uint256 viewId, address authorisedEngine, address authorisedSettlement, address token) external returns (address vault)`
- `getVault(uint256 viewId) external view returns (address vault)`
- `vaultExists(uint256 viewId) external view returns (bool)`

**Events (Vault):**
- `Deposited(uint256 indexed viewId, address indexed caller, uint256 amount)`
- `Withdrawn(uint256 indexed viewId, address indexed receiver, uint256 amount)`
- `Settled(uint256 indexed viewId, address indexed receiver, uint256 amount)`
- `FeeReleased(uint256 indexed viewId, address indexed recipient, uint256 amount)`
- `FeeRecordedNotified(uint256 indexed viewId, uint256 amount)`

**Errors (Vault):**
- `Vault__UnauthorisedEngine()`
- `Vault__UnauthorisedSettlement()`
- `Vault__UnauthorisedFeeManager()`
- `Vault__ZeroAmount()`
- `Vault__InsufficientBalance()`
- `Vault__ZeroAddress()`
- `Vault__InvalidRecipient()`
- `Vault__InvariantViolation()`
- `Vault__FeeManagerNotSet()`
- `Vault__FeeManagerAlreadySet()`
- `Vault__FeeExceedsRecorded(uint256 requested, uint256 available)`

**External Functions (Vault):**
- `deposit(uint256 amount) external`
- `withdraw(address to, uint256 amount) external`
- `settle(address to, uint256 amount) external`
- `releaseFee(address recipient, uint256 amount) external`
- `setFeeManager(address feeManager) external`
- `notifyFeeRecorded(uint256 amount) external`
- `viewId() external view returns (uint256)`
- `token() external view returns (address)`
- `balance() external view returns (uint256)`
- `totalDeposits() external view returns (uint256)`
- `totalWithdrawals() external view returns (uint256)`
- `totalSettled() external view returns (uint256)`
- `totalFeesReleased() external view returns (uint256)`
- `totalFeesRecorded() external view returns (uint256)`
- `authorizedFeeManager() external view returns (address)`
