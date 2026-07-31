# Pulse Protocol V1 Specification

## 1. Protocol Overview

Pulse Protocol V1 is a modular, decentralized prediction market protocol designed for high capital efficiency, strict security isolation, and permissionless execution. Its core objective is to provide a robust, manipulation-resistant platform for creating and trading prediction markets (referred to as "Views").

The protocol is built upon a highly decoupled, modular architecture enforcing the Principle of Least Privilege [1]. By separating trading execution, asset custody, fee accounting, and settlement into independent smart contracts, the protocol guarantees that no single module possesses overarching authority. This design minimizes the attack surface and is designed to maintain strict capital safety invariants.

---

## 2. Core Architecture

The protocol is composed of six core modules, each with strictly defined boundaries.

### PulseFactory
-   **Responsibility:** Global registry and sole entry point for creating prediction markets (Views) and deploying Vaults [1] [2].
-   **Allowed Actions:** Create Views, register Vaults, and store immutable ViewRecords (including FeeConfig and PriceEngine snapshots) [3] [4].
-   **Forbidden Actions:** Modifying existing View parameters after creation [1].

### TradingEngine
-   **Responsibility:** Market orchestrator and internal position accounting layer [1] [5].
-   **Allowed Actions:** Trade execution (`buy`/`sell`), Position accounting, and Market state management (lifecycle transitions) [1] [5].
-   **Forbidden Actions:** Holding ERC20 funds, calculating prices, holding fee balances, modifying settlement results, or bypassing the PriceEngine [1] [5].

### MarketVault
-   **Responsibility:** Sole custodian of all physical ERC20 settlement tokens [1] [6].
-   **Allowed Actions:** Deposit funds, withdraw funds, and release fees strictly upon commands from authorized modules (`TradingEngine`, `SettlementManager`, `FeeManager`) [6].
-   **Forbidden Actions:** Trading logic, price awareness, admin withdrawals, arbitrary fund transfers, or hidden rescue permissions [1] [6].

### FeeManager
-   **Responsibility:** Pure accounting module for protocol fee splits [1] [7].
-   **Allowed Actions:** Recording fees internally and calling `MarketVault.releaseFee()` to distribute fees via a Pull-over-Push model [1] [7].
-   **Forbidden Actions:** Holding physical ERC20 assets, modifying trade logic, or changing the fund flow model [1] [7].

### SettlementManager
-   **Responsibility:** Execution-only module for market resolution [1] [8].
-   **Allowed Actions:** Reading the finalized TWAP to determine the winning side, calculating proportional payouts, and instructing the Vault to settle claims [1] [8].
-   **Forbidden Actions:** Modifying historical market rules, modifying user positions, or modifying prices [1].

### PriceEngine
-   **Responsibility:** Pure, stateless mathematical engine implementing the bonding curve and solvency checks [1] [6].
-   **Allowed Actions:** Price calculation, Pulse Index calculation, and quote generation (`quoteBuy`/`quoteSell`) [1].
-   **Forbidden Actions:** Storing state, holding assets, participating in settlement flows, or making external calls [1].

---

## 3. Market Model

Pulse Protocol V1 supports two specific types of prediction markets (Views) [1].

### Fixed Market
-   **Creation:** Deployed via `PulseFactory` with a specific `startTime` and `endTime` [3].
-   **Lifecycle:** Trading is permitted while `block.timestamp < endTime`. Once the `endTime` is reached, trading ceases, and the market enters Settlement [1] [3].
-   **Constraint:** Must have a minimum duration to guarantee a valid settlement window (`endTime >= startTime + SETTLEMENT_WINDOW + MIN_TRADING_DURATION`) [3].
-   **Settlement:** Settles based on the finalized TWAP at the end of the trading period [8].

### Permanent Market
-   **Creation:** Deployed via `PulseFactory` with `endTime == 0` [3].
-   **Lifecycle:** Remains in the `ACTIVE` state forever [3] [4].
-   **Constraint:** Never enters Settlement. The `TradingEngine.lockMarket` function explicitly rejects locking for PERMANENT markets [1] [4].
-   **Termination:** V1 prohibits automatic closure and defines no termination mechanism for PERMANENT markets [1].

---

## 4. Trading Model

The trading model is orchestrated entirely by the `TradingEngine`, which coordinates with the `PriceEngine` for calculations [5].

1.  **Validation:** The `TradingEngine` verifies the market is `ACTIVE` and inputs are valid [5].
2.  **Calculation:** The `TradingEngine` calls the `PriceEngine` (`quoteBuy` or `quoteSell`) to calculate the required shares or amounts, the new Pulse Index, and the new reserve balance [5].
3.  **Accounting:** The `TradingEngine` updates its internal `Position` mapping for the user (adding or removing `forShares` / `againstShares`) [5] [9].
4.  **Execution:** The `TradingEngine` commands the `MarketVault` to process the physical ERC20 transfer and commands the `FeeManager` to record any applicable fees [5].

---

## 5. Asset Flow

To guarantee security, physical assets and internal accounting are strictly separated [6].

-   **Flow:** User → `TradingEngine` (Orchestration) → `MarketVault` (Custody) [5].
-   **Custody:** The `MarketVault` is the sole custodian of all assets [1] [6].
-   **Accounting:** The `FeeManager` and `TradingEngine` only maintain internal ledgers and never hold physical tokens [1] [6].
-   **Constraint:** Arbitrary fund transfers are strictly forbidden. Funds only move during `buy`, `sell`, `claimReward`, or `claimXxxFee` operations [1] [6].

---

## 6. Fee Model

The fee model utilizes an accounting-only approach with a Pull-over-Push distribution mechanism [7].

-   **Generation:** Fees are generated during trading and calculated as a percentage of the transaction [5].
-   **Accounting:** The `TradingEngine` calls `FeeManager.recordFee()`. The `FeeManager` updates its internal ledger and synchronously notifies the `MarketVault` of the new fee obligation (`notifyFeeRecorded()`) to enforce quota protection [7].
-   **Distribution:** Recipients (Creator, Treasury, Team) must explicitly call their respective claim functions (`claimCreatorFee`, `claimTreasuryFee`, `claimTeamFee`) [7].
-   **Execution:** The `FeeManager` zeroes the ledger (CEI pattern) and calls `MarketVault.releaseFee()`, which physically transfers the tokens to the recipient [7].
-   **Fee Split:** Defined in implementation configuration [7].

---

## 7. Settlement Model

Settlement is an execution-only process managed by the `SettlementManager` [8].

1.  **Locking:** Once `endTime` is reached, anyone can call `TradingEngine.lockMarket()`, which finalizes the TWAP and transitions the state to `LOCKED` [5] [8].
2.  **Settlement:** Anyone can call `SettlementManager.settleMarket()`. This transitions the state to `SETTLEMENT`, reads the finalized TWAP, determines the result, and transitions the state to `CLAIMABLE` [5] [8].
3.  **Determination:**
    -   TWAP > 5000: `FOR_WINS` [8].
    -   TWAP < 5000: `AGAINST_WINS` [8].
    -   TWAP = 5000: `DRAW` (proportional refund) [8].
4.  **Claiming:** In the `CLAIMABLE` state, anyone can call `claimReward()`. The `SettlementManager` calculates the payout based on the user's winning shares and the total reserve, marks the position as claimed in the `TradingEngine`, and instructs the `MarketVault` to release the funds [5] [8].

---

## 8. State Machine

The `TradingEngine` enforces a strict, unidirectional lifecycle for every FIXED View [6] [10].

1.  **ACTIVE:** Market is open for trading. TWAP snapshots are recorded periodically [10].
2.  **LOCKED:** Trading has ceased; TWAP is finalized. Waiting for `SettlementManager` to begin settlement [10].
3.  **SETTLEMENT:** Transient state during the execution of `SettlementManager.settleMarket()` [10].
4.  **CLAIMABLE:** Terminal state. Settlement is complete, and users can claim rewards [10].

For PERMANENT markets, the state remains **ACTIVE** forever [1] [4].

---

## 9. Security Invariants

Pulse Protocol V1 is secured by mathematically proven invariants that must hold true across all operations [1] [6].

-   **Vault Custody Invariant:** All ERC20 settlement tokens physically reside in the `MarketVault` [6].
-   **Capital Conservation Invariant:** `Vault.balance() + totalWithdrawals + totalSettled + totalFeesReleased >= totalDeposits` [1] [6].
-   **Solvency Invariant:** `min(forSupply, againstSupply) <= reserveBalance`. This ensures the protocol can always fully refund the losing side and proportionally pay the winning side [1] [6].
-   **Fee Quota Protection:** `totalFeesReleased <= totalFeesRecorded`. The Vault independently guarantees that the FeeManager cannot over-release fees [6].
-   **Immutable Economic Rules:** The economic rules of an existing View (Fee Rate, Settlement Rule, Collateral Token, PriceEngine Version) are permanently immutable after creation [1].

---

## 10. V1 Scope Boundary

This Specification defines the Stage 6.5 Security Hardened baseline of Pulse Protocol V1 [4]. It explicitly **does not contain**:
-   V2 designs or concepts [1] [11].
-   Unimplemented features [1] [11].
-   External extensions or DAO governance mechanisms [1] [11].

All future V1 development must strictly adhere to this official baseline [4] [11].

---

## References

[1] [docs/Protocol_Constitution.md](/home/ubuntu/pulse-protocol-v1/docs/Protocol_Constitution.md)  
[2] [docs/Protocol_Security_Standard.md](/home/ubuntu/pulse-protocol-v1/docs/Protocol_Security_Standard.md)  
[3] [contracts/interfaces/IPulseFactory.sol](/home/ubuntu/pulse-protocol-v1/contracts/interfaces/IPulseFactory.sol)  
[4] [docs/Stage6_5_Security_Hardened_Report.md](/home/ubuntu/pulse-protocol-v1/docs/Stage6_5_Security_Hardened_Report.md)  
[5] [docs/design/TradingEngine/TradingEngine_CallFlow.md](/home/ubuntu/pulse-protocol-v1/docs/design/TradingEngine/TradingEngine_CallFlow.md)  
[6] [docs/Stage5_Core_Completion_Report.md](/home/ubuntu/pulse-protocol-v1/docs/Stage5_Core_Completion_Report.md)  
[7] [contracts/fee/FeeManager.sol](/home/ubuntu/pulse-protocol-v1/contracts/fee/FeeManager.sol)  
[8] [contracts/settlement/SettlementManager.sol](/home/ubuntu/pulse-protocol-v1/contracts/settlement/SettlementManager.sol)  
[9] [docs/design/TradingEngine/TradingEngine_Storage_Layout.md](/home/ubuntu/pulse-protocol-v1/docs/design/TradingEngine/TradingEngine_Storage_Layout.md)  
[10] [docs/design/TradingEngine/TradingEngine_StateMachine.md](/home/ubuntu/pulse-protocol-v1/docs/design/TradingEngine/TradingEngine_StateMachine.md)  
[11] [docs/Stage6_5_Merge_Impact_Analysis.md](/home/ubuntu/pulse-protocol-v1/docs/Stage6_5_Merge_Impact_Analysis.md)  
