# Pulse Protocol V1 Economic Model Specification

This document details the economic model, mathematical formulas, and settlement mechanics of Pulse Protocol V1. All definitions herein are strictly derived from the implemented smart contracts and official documentation.

---

## 1. Economic Overview

Pulse Protocol V1 employs a fully-collateralized, zero-LP Continuous Scoring Market (CSM) [1]. It is designed to facilitate permissionless, two-sided prediction markets without requiring external liquidity providers. The economic engine relies on a dynamic pricing algorithm where share prices are derived continuously from the ratio of outstanding shares on both sides [1].

---

## 2. Market Economic Model

### YES / NO Shares (FOR / AGAINST)
The protocol issues Position Shares representing a proportional claim on the final Vault Reserve if the holder's side wins at settlement [1].
-   **Side 0 (FOR):** Represents a "YES" position.
-   **Side 1 (AGAINST):** Represents a "NO" position.
These shares do *not* represent a fixed claim of 1 collateral token [1].

### Reserve Model
The `reserveBalance` is the virtual tracking of net collateral held in the Vault for a specific market. It strictly grows with every buy and shrinks with every sell [1].

### Pulse Index
The Pulse Index is the core metric reflecting the current market probability estimate. It is defined in basis points (BPS), with a strictly enforced range of `[1, 9999]` [1] [2].
-   `INITIAL_INDEX` = `5000` (50/50 probability) [2].
-   **Formula:** `index = floor(forSupply * 10000 / (forSupply + againstSupply))` [2].

### Price Calculation
Share prices are directly derived from the Pulse Index and are always strictly less than 1.0 [1].
-   **FOR Price:** `sharePrice = pulseIndex / 10000` [1].
-   **AGAINST Price:** `sharePrice = (10000 - pulseIndex) / 10000` [1].

---

## 3. Trading Economics

All trading math utilizes full-precision 512-bit intermediate arithmetic (`MathLibrary.mulDiv`) to prevent overflow and precision loss [1] [2].

### Buy
When a user buys shares, they deposit collateral (net of fees) and receive newly minted shares [1].
-   **Formula:** `sharesOut = floor(amountIn * 10000 / sidePrice_bps)` [1].
-   The reserve increases by `amountIn` [1].

### Sell
When a user sells shares, they burn their shares and receive collateral from the reserve [1].
-   **Formula:** `amountOut = floor(sharesIn * sidePrice_bps / 10000)` [1].
-   The reserve decreases by `amountOut` [1].

### Fee Generation
Trading fees are deducted from the gross transaction amount *before* the net amount interacts with the bonding curve [3].
-   **Formula:** `feeAmount = floor(grossAmount * feeBps / 10000)` [2].
-   **Net Amount:** `netAmount = grossAmount - feeAmount` [2].

---

## 4. Settlement Economics

### TWAP Settlement
Settlement relies exclusively on a Time-Weighted Average Price (TWAP) calculated over a 30-minute window prior to market closure [4]. Spot prices are never used for settlement [5].
-   **Formula:** `finalTWAP = Σ(pulseIndex[i] * duration[i]) / Σ(duration[i])` [4].
-   **Fallback Rules:**
    -   If no trades occur during the settlement window, the last recorded index before the window is used [4].
    -   If the market has zero activity from creation to closure, it defaults to `INITIAL_INDEX` (`5000`) [4].

### Payout Determination
The `SettlementManager` reads the `finalTWAP` to determine the winner and calculate proportional payouts [6].

#### FOR_WINS (TWAP > 5000)
-   **Condition:** Final TWAP is strictly greater than 5000 [6].
-   **Payout:** `payout = (userForShares / totalForSupply) * totalReserve` [6].

#### AGAINST_WINS (TWAP < 5000)
-   **Condition:** Final TWAP is strictly less than 5000 [6].
-   **Payout:** `payout = (userAgainstShares / totalAgainstSupply) * totalReserve` [6].

#### DRAW (TWAP == 5000)
-   **Condition:** Final TWAP is exactly 5000 [6].
-   **Payout:** Proportional refund to all shareholders. `payout = (userTotalShares / totalSupply) * totalReserve` [6].

---

## 5. Capital Safety Model

### Vault Backing
All physical ERC20 settlement tokens reside exclusively in the `MarketVault` [7]. The `TradingEngine` and `FeeManager` maintain internal ledgers but hold zero physical assets [3] [7].

### Solvency Invariant
The protocol utilizes a "Capped Payout" model, acknowledging that `max(forSupply, againstSupply) > reserveBalance` is normal in a zero-LP CSM [1]. To guarantee the protocol never owes more than it holds, the following invariant is enforced after every trade:
-   `min(forSupply, againstSupply) <= reserveBalance` [1].

### Accounting Invariant
The Vault strictly enforces capital conservation:
-   `Vault.balance() + totalFeesReleased >= TradingEngine.reserveBalance` [8].

---

## 6. Fee Economics

### Fee Generation
Fees are generated as a fixed percentage of the transaction volume during `buy` and `sell` operations [3]. The total fee rate is `100 bps` (1.00%) [3].

### Accounting
The `FeeManager` is an accounting-only module [3]. When a trade occurs, the `TradingEngine` calls `FeeManager.recordFee()`, which updates the internal ledgers for the Creator, Treasury, and Team [3].

### Distribution
Fees are distributed using a Pull-over-Push model [3]. The split is defined as:
-   **Creator:** 50% (`50 bps`) [3].
-   **Treasury:** 30% (`30 bps`) [3].
-   **Team:** 20% (`20 bps`) [3].
Dust from integer division is absorbed into the Team share [3]. Recipients must call `claimXxxFee()`, which zeroes their ledger and instructs the Vault to release the physical tokens [3].

---

## 7. Immutable Economic Rules

Upon the creation of a View via the `PulseFactory`, specific economic parameters are snapshotted into a `ViewRecord` and become permanently immutable [5] [9]. These include:
-   **Fee Rate Configuration** (`FeeConfig`) [9].
-   **PriceEngine Version** [9].
-   **SettlementManager Version** [9].
-   **Collateral Token** [5].
-   **EndTime** (Determines if the market is FIXED or PERMANENT) [9].

*Note: For PERMANENT markets (`endTime == 0`), V1 prohibits automatic closure and defines no termination mechanism. They remain ACTIVE indefinitely and never enter Settlement [10].*

---

## References

[1] [contracts/pricing/PriceEngine.sol](/home/ubuntu/pulse-protocol-v1/contracts/pricing/PriceEngine.sol)  
[2] [contracts/libraries/MathLibrary.sol](/home/ubuntu/pulse-protocol-v1/contracts/libraries/MathLibrary.sol)  
[3] [contracts/fee/FeeManager.sol](/home/ubuntu/pulse-protocol-v1/contracts/fee/FeeManager.sol)  
[4] [contracts/libraries/TWAPLibrary.sol](/home/ubuntu/pulse-protocol-v1/contracts/libraries/TWAPLibrary.sol)  
[5] [docs/Protocol_Security_Standard.md](/home/ubuntu/pulse-protocol-v1/docs/Protocol_Security_Standard.md)  
[6] [contracts/settlement/SettlementManager.sol](/home/ubuntu/pulse-protocol-v1/contracts/settlement/SettlementManager.sol)  
[7] [docs/Stage5_Core_Completion_Report.md](/home/ubuntu/pulse-protocol-v1/docs/Stage5_Core_Completion_Report.md)  
[8] [contracts/vault/MarketVault.sol](/home/ubuntu/pulse-protocol-v1/contracts/vault/MarketVault.sol)  
[9] [contracts/interfaces/IPulseFactory.sol](/home/ubuntu/pulse-protocol-v1/contracts/interfaces/IPulseFactory.sol)  
[10] [docs/Protocol_Constitution.md](/home/ubuntu/pulse-protocol-v1/docs/Protocol_Constitution.md)  
