# Pulse Protocol V1 Final Freeze Declaration

**Status:** Official Freeze Declaration  
**Baseline:** Stage 6.5 Security Hardened  
**Repository:** `aess-code/pulse-protocol-v1`

This document formally declares the Pulse Protocol V1 Stage 6.5 Security Hardened baseline as the official frozen version of the protocol. It serves as the authoritative reference for all future development, integration, and audit activities.

---

## 1. V1 Freeze Status

Pulse Protocol V1 has completed the Stage 6.5 Security Hardened baseline. This version incorporates all core module implementations and all security fixes identified during the Stage 6 Independent Security Audit [1] [2].

The current official baseline is defined by the `aess-code/pulse-protocol-v1` repository, `main` branch, tag `v1.0.0-stage6.5-official`. This baseline is the **Single Source of Truth** for all V1 protocol rules, interfaces, and economic parameters [3].

---

## 2. Immutable Core Rules

The following rules are permanently frozen and must not be altered in any future V1 patch or integration.

### Architecture Boundaries
The modular architecture enforcing the Principle of Least Privilege is frozen [3]. The six core modules (`PulseFactory`, `TradingEngine`, `MarketVault`, `FeeManager`, `SettlementManager`, `PriceEngine`) and their defined responsibilities and forbidden actions cannot be changed [3] [4].

### Market Types
Pulse Protocol V1 supports exactly two market types: `FIXED` and `PERMANENT`. Their definitions, creation rules, and lifecycle behaviors are frozen as specified in `IPulseFactory.sol` [5].

### Settlement Rules
Settlement is exclusively determined by the finalized TWAP over the 30-minute settlement window [6]. The three outcomes (`FOR_WINS` when TWAP > 5000, `AGAINST_WINS` when TWAP < 5000, `DRAW` when TWAP == 5000) and their proportional payout formulas are frozen [6] [7].

### Fee Rules
The total protocol fee is fixed at 1.00% (100 bps) per trade. The distribution split (Creator 50%, Treasury 30%, Team 20%) is frozen [7]. The Pull-over-Push claim model via `FeeManager` and `MarketVault.releaseFee()` is frozen [7].

### Economic Parameters
The Continuous Scoring Market (CSM) pricing algorithm, the Pulse Index range `[1, 9999]`, the buy/sell formulas, and the Capped Payout solvency model are frozen as implemented in `PriceEngine.sol` and `MathLibrary.sol` [8].

### Vault Custody Model
The `MarketVault` is the sole custodian of all physical ERC20 settlement tokens. The accounting invariant (`Vault.balance() + totalWithdrawals + totalSettled + totalFeesReleased >= totalDeposits`) and the solvency invariant (`min(forSupply, againstSupply) <= reserveBalance`) are frozen [3] [4].

---

## 3. Allowed Future Changes

Future V1 changes are restricted to the following categories only.

**Permitted:**
-   **Bug Fixes:** Correcting implementation errors that cause behavior to deviate from the frozen specification.
-   **Security Patches:** Addressing newly discovered vulnerabilities, provided the fix does not alter any frozen economic rule, settlement mechanism, market lifecycle, or asset custody model.
-   **Documentation Improvements:** Clarifying or expanding existing documentation without changing the underlying rules.

**Prohibited in any future V1 change:**
-   Altering economic rules (fee rates, settlement formulas, pricing algorithm) [3].
-   Modifying the settlement mechanism or TWAP calculation [3] [6].
-   Changing the market lifecycle state machine [4].
-   Altering the asset custody model (Vault as sole custodian) [3].

---

## 4. Excluded Scope

The following are explicitly outside the scope of Pulse Protocol V1 and must not be introduced under the V1 designation [3] [9].

-   **V2 Architecture:** Any redesign of the core protocol modules or economic model.
-   **DAO Governance:** Any on-chain governance mechanism for protocol parameter changes.
-   **Token System:** Any protocol-native token for governance or fee distribution.
-   **Tokenized Shares:** ERC20 or ERC1155 tokenization of Position Shares.
-   **Permanent Market Termination Mechanism:** V1 defines no mechanism to close or settle a PERMANENT market [3].

---

## 5. Developer Integration Rule

Any future development that builds upon or integrates with Pulse Protocol V1 must comply with this frozen baseline.

-   **Frontend Applications:** Must use the frozen interface ABIs from `contracts/interfaces/`. Any UI behavior must accurately reflect the on-chain state machine and settlement rules defined in this baseline [3] [4].
-   **SDK Development:** Must implement the frozen function signatures, including the slippage protection parameters (`minSharesOut` for `buy`, `minAmountOut` for `sell`) introduced in Stage 6.5 [2] [4].
-   **Partner Integrations:** Must reference the frozen `ViewRecord` structure from `IPulseFactory.sol` for all market data [5].

The `aess-code/pulse-protocol-v1` repository is the only valid source for V1 contract ABIs, interface definitions, and protocol rules [3].

---

## References

[1] [docs/Stage6_5_Security_Hardened_Report.md](/home/ubuntu/pulse-protocol-v1/docs/Stage6_5_Security_Hardened_Report.md)  
[2] [docs/Stage6_5_Merge_Impact_Analysis.md](/home/ubuntu/pulse-protocol-v1/docs/Stage6_5_Merge_Impact_Analysis.md)  
[3] [docs/Protocol_Constitution.md](/home/ubuntu/pulse-protocol-v1/docs/Protocol_Constitution.md)  
[4] [docs/Protocol_Specification.md](/home/ubuntu/pulse-protocol-v1/docs/Protocol_Specification.md)  
[5] [contracts/interfaces/IPulseFactory.sol](/home/ubuntu/pulse-protocol-v1/contracts/interfaces/IPulseFactory.sol)  
[6] [docs/Economic_Model_Specification.md](/home/ubuntu/pulse-protocol-v1/docs/Economic_Model_Specification.md)  
[7] [contracts/fee/FeeManager.sol](/home/ubuntu/pulse-protocol-v1/contracts/fee/FeeManager.sol)  
[8] [contracts/pricing/PriceEngine.sol](/home/ubuntu/pulse-protocol-v1/contracts/pricing/PriceEngine.sol)  
[9] [docs/Product_Specification.md](/home/ubuntu/pulse-protocol-v1/docs/Product_Specification.md)  
