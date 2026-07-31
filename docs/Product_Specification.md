# Pulse Protocol V1 Product Specification

This document describes the product-level rules and user-facing behavior of Pulse Protocol V1. All content is derived strictly from the existing contracts and documentation in this repository.

---

## 1. Product Overview

Pulse Protocol V1 is a permissionless, decentralized prediction market protocol [1]. It enables anyone to create a prediction market (referred to as a **View**), and anyone to participate by taking a position on the outcome [1].

A **View** is the fundamental unit of the protocol. It is a prediction market with two sides: **FOR** and **AGAINST**. Users express their opinion by buying shares on either side. The market price continuously reflects the collective probability estimate of participants [1] [2].

---

## 2. User Roles

The protocol defines the following roles based on the implemented smart contracts.

| Role | Description | Defined Permissions |
| :--- | :--- | :--- |
| **Creator** | The address that deploys a View via `PulseFactory.createView()`. | Receives the Creator share of protocol fees (50% of total fees) [3]. |
| **Trader / Participant** | Any address that calls `TradingEngine.buy()` or `TradingEngine.sell()`. | Buys and sells Position Shares; claims settlement rewards via `SettlementManager.claimReward()` [4] [5]. |
| **Treasury** | A fixed address configured at `FeeManager` deployment. | Receives the Treasury share of protocol fees (30% of total fees) [3]. |
| **Team** | A fixed address configured at `FeeManager` deployment. | Receives the Team share of protocol fees (20% of total fees, absorbing rounding dust) [3]. |

---

## 3. View Market Model

### Fixed Market
A Fixed Market has a defined trading period with a specific end time [6].
-   **Creation:** Deployed via `PulseFactory.createView()` with `viewType = FIXED` and a valid `endTime`. The minimum required duration is `endTime >= startTime + 30 minutes + 30 minutes` [6].
-   **Trading:** Users may call `buy()` and `sell()` while `block.timestamp < endTime` and the market status is `ACTIVE` [4].
-   **Ending:** Once `endTime` is reached, any address may call `TradingEngine.lockMarket()` to finalize the TWAP and transition the market to `LOCKED` [4].
-   **Settlement:** Once `LOCKED`, any address may call `SettlementManager.settleMarket()` to determine the outcome and transition the market to `CLAIMABLE` [5].

### Permanent Market
A Permanent Market has no defined end time [6].
-   **Rule:** Deployed with `endTime == 0`. The market remains in the `ACTIVE` state indefinitely [1] [6].
-   **Trading:** Users may call `buy()` and `sell()` at any time [4].
-   **Closure:** V1 prohibits automatic closure. The `TradingEngine.lockMarket()` function explicitly rejects locking for PERMANENT markets [1].
-   **Settlement:** Not Defined in V1. PERMANENT markets do not enter Settlement and have no termination mechanism in V1 [1].

---

## 4. User Interaction Flow

The following describes the on-chain interaction flow for a FIXED market. Steps that are not implemented on-chain are explicitly noted.

| Step | Description | On-Chain Implementation |
| :--- | :--- | :--- |
| **Create View** | A Creator calls `PulseFactory.createView()` to deploy a new prediction market. | Implemented: `PulseFactory.createView()` [6]. |
| **Discover View** | A user finds an active View to participate in. | **Not Defined in V1.** Discovery is a frontend/off-chain concern. |
| **Support / Oppose** | A user decides to take a FOR or AGAINST position. | **Not Defined in V1.** This is a user decision. |
| **Trade** | A user calls `TradingEngine.buy()` to acquire shares or `TradingEngine.sell()` to exit a position. | Implemented: `TradingEngine.buy()`, `TradingEngine.sell()` [4]. |
| **Settlement** | After `endTime`, anyone calls `lockMarket()`, then anyone calls `settleMarket()`. | Implemented: `TradingEngine.lockMarket()`, `SettlementManager.settleMarket()` [4] [5]. |
| **Claim** | Winners call `SettlementManager.claimReward()` to receive their payout. | Implemented: `SettlementManager.claimReward()` [5]. |

---

## 5. Trading Experience

### Buy
A user deposits a settlement token and receives Position Shares on their chosen side (FOR or AGAINST). The number of shares received is determined by the current Pulse Index [2] [4].
-   A 1.00% protocol fee is deducted from the gross deposit amount before the net amount is used to calculate shares [3].
-   The user must approve the `TradingEngine` contract to spend their settlement tokens before calling `buy()` [4].
-   **Slippage Protection:** The `buy()` function accepts a `minSharesOut` parameter. If the actual shares received are below this value, the transaction reverts with `TradingEngine__SlippageExceeded` [4].

### Sell
A user burns their Position Shares and receives settlement tokens from the Vault reserve [2] [4].
-   A 1.00% protocol fee is deducted from the gross output amount [3].
-   **Slippage Protection:** The `sell()` function accepts a `minAmountOut` parameter [4].

### Position
A user's position is tracked internally in the `TradingEngine` as a `Position` struct containing `forShares`, `againstShares`, and `claimStatus` [7]. Positions are not tokenized as ERC20 or ERC1155 tokens in V1.

### Shares
Position Shares represent a proportional claim on the final Vault Reserve if the holder's side wins at settlement. They do not represent a fixed 1:1 claim on the collateral token [2].

### Fee
The total protocol fee is 1.00% (100 basis points) per trade, applied to both buy and sell operations [3].

---

## 6. Settlement Experience

### TWAP
Settlement is based on the Time-Weighted Average Pulse Index calculated over the last 30 minutes of the market's trading period [8]. Snapshots are recorded at most once per 60 seconds during this window [8].

### FOR Wins
If the final TWAP is greater than 5000, the FOR side wins. FOR shareholders receive a proportional payout from the total reserve [5].

### AGAINST Wins
If the final TWAP is less than 5000, the AGAINST side wins. AGAINST shareholders receive a proportional payout from the total reserve [5].

### DRAW
If the final TWAP is exactly 5000, the result is a DRAW. All shareholders receive a proportional refund based on their share of the total supply [5].

### Claim
Once the market is in the `CLAIMABLE` state, any address may call `SettlementManager.claimReward(viewId, user)` on behalf of any user. The payout is always sent to the position holder (`user`), never to `msg.sender` [5].

---

## 7. Fee and Treasury Flow

### Fee Generation
Fees are generated on every `buy()` and `sell()` transaction at a fixed rate of 1.00% [3].

### Fee Recording
The `TradingEngine` calls `FeeManager.recordFee()` after each trade. The `FeeManager` splits the total fee into three internal ledger entries (Creator, Treasury, Team) and notifies the Vault of the new fee obligation [3].

### Fee Claiming
Fee recipients use a Pull-over-Push model. Each recipient must explicitly call their respective claim function to receive their fees [3].
-   **Creator:** Calls `FeeManager.claimCreatorFee(viewId)`.
-   **Treasury:** Calls `FeeManager.claimTreasuryFee(viewId)`.
-   **Team:** Calls `FeeManager.claimTeamFee(viewId)`.

Upon claiming, the `FeeManager` zeroes the internal ledger and instructs the `MarketVault` to release the physical tokens to the recipient [3].

---

## 8. V1 Product Boundary

Pulse Protocol V1 is defined by the Stage 6.5 Security Hardened baseline. The following are explicitly **not included** in V1 [1]:
-   V2 protocol designs or upgrades.
-   DAO governance mechanisms.
-   On-chain market discovery or curation.
-   Tokenized position shares (ERC20 / ERC1155).
-   A termination mechanism for PERMANENT markets.
-   Any feature not implemented in the `aess-code/pulse-protocol-v1` repository.

---

## References

[1] [docs/Protocol_Constitution.md](/home/ubuntu/pulse-protocol-v1/docs/Protocol_Constitution.md)  
[2] [docs/Economic_Model_Specification.md](/home/ubuntu/pulse-protocol-v1/docs/Economic_Model_Specification.md)  
[3] [contracts/fee/FeeManager.sol](/home/ubuntu/pulse-protocol-v1/contracts/fee/FeeManager.sol)  
[4] [contracts/TradingEngine.sol](/home/ubuntu/pulse-protocol-v1/contracts/TradingEngine.sol)  
[5] [contracts/settlement/SettlementManager.sol](/home/ubuntu/pulse-protocol-v1/contracts/settlement/SettlementManager.sol)  
[6] [contracts/interfaces/IPulseFactory.sol](/home/ubuntu/pulse-protocol-v1/contracts/interfaces/IPulseFactory.sol)  
[7] [docs/design/TradingEngine/TradingEngine_Storage_Layout.md](/home/ubuntu/pulse-protocol-v1/docs/design/TradingEngine/TradingEngine_Storage_Layout.md)  
[8] [contracts/libraries/TWAPLibrary.sol](/home/ubuntu/pulse-protocol-v1/contracts/libraries/TWAPLibrary.sol)  
