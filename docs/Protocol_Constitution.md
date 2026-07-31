# Pulse Protocol V1 — Protocol Constitution

**Status:** Official Single Source of Truth for Pulse Protocol V1  
**Scope:** V1 Architecture and Implementation Boundary Only

This Constitution defines the immutable core principles, architectural boundaries, and security invariants of Pulse Protocol V1. It is the highest authority for V1 development. Any modification that violates this Constitution is strictly forbidden. This document constrains V1 only and does not apply to V2 or future designs.

---

## 1. Core Principles

Pulse Protocol V1 is built upon a highly decoupled, modular architecture enforcing the Principle of Least Privilege. The core principles are:

1.  **Correctness:** The protocol must behave exactly as specified.
2.  **Security:** The protocol must be resistant to all known attack vectors, designed to maintain strict capital safety invariants.
3.  **Auditability:** Contracts must be readable and verifiable by third-party auditors without internal documentation.
4.  **Gas Optimization:** Gas savings are acceptable only if they do not compromise the above three priorities.

*Source: `docs/Protocol_Security_Standard.md`*

---

## 2. Immutable Architectural Boundaries

The protocol separates trading execution, asset custody, fee accounting, and settlement into independent contracts. Every module is strictly limited to its defined responsibility.

### TradingEngine
-   **Responsibility:** Market orchestrator and internal position accounting layer. Manages the lifecycle state machine (ACTIVE → LOCKED → SETTLEMENT → CLAIMABLE).
-   **Forbidden:** Holding ERC20 funds, calculating prices, holding fee balances, modifying settlement results.

*Source: `docs/Stage5_Core_Completion_Report.md`, `docs/design/TradingEngine/TradingEngine_Architecture_Specification.md`, `docs/Protocol_Security_Standard.md`*

### MarketVault
-   **Responsibility:** Sole custodian of all physical ERC20 settlement tokens. Operates strictly on commands from authorized modules.
-   **Forbidden:** Trading logic, price awareness, admin withdrawals, arbitrary fund transfers, hidden rescue permissions.

*Source: `docs/Stage5_Core_Completion_Report.md`, `docs/Stage6_5_Security_Hardened_Report.md`*

### FeeManager
-   **Responsibility:** Pure accounting module for protocol fee splits. Uses a Pull-over-Push model to instruct the Vault to release funds.
-   **Forbidden:** Holding physical ERC20 assets, modifying trade logic, changing the fund flow model.

*Source: `docs/Stage5_Core_Completion_Report.md`, `docs/Stage6_5_Security_Hardened_Report.md`, `docs/Protocol_Security_Standard.md`*

### PriceEngine
-   **Responsibility:** Pure, stateless mathematical engine implementing the bonding curve and solvency checks.
-   **Forbidden:** Storing state, holding assets, participating in settlement flows, external calls.

*Source: `docs/Stage5_Core_Completion_Report.md`, `docs/Protocol_Security_Standard.md`, `docs/Stage6_5_Security_Hardened_Report.md`*

### SettlementManager
-   **Responsibility:** Execution-only module that reads the finalized TWAP to determine the winning side, calculates proportional payouts, and instructs the Vault to settle claims.
-   **Forbidden:** Modifying historical market rules, modifying user positions, modifying prices.

*Source: `docs/Stage5_Core_Completion_Report.md`, `docs/Protocol_Security_Standard.md`*

### PulseFactory
-   **Responsibility:** Global registry and sole entry point for creating prediction markets (Views) and deploying Vaults.
-   **Forbidden:** Modifying existing View parameters after creation.

*Source: `docs/Stage5_Core_Completion_Report.md`, `docs/Protocol_Security_Standard.md`*

---

## 3. Security Principles

### Minimum Privilege
No module may acquire or exercise permissions beyond its strict boundary. The TradingEngine orchestrates; the MarketVault holds funds; the FeeManager accounts; the PriceEngine calculates.

*Source: `docs/Protocol_Security_Standard.md`, `docs/Stage6_5_Security_Hardened_Report.md`*

### Capital Safety & Accounting Invariants
The protocol enforces capital safety through the following invariant:
`Vault.balance() + totalWithdrawals + totalSettled + totalFeesReleased >= totalDeposits`

Furthermore, the Solvency Invariant must always hold:
`min(forSupply, againstSupply) <= reserveBalance`

Any state where User Claim Value > Vault Assets is strictly forbidden.

*Source: `docs/Stage5_Core_Completion_Report.md`, `docs/Protocol_Security_Standard.md`*

### Immutable Economic Rules
The economic rules of an existing View are permanently immutable after creation. This includes the Fee Rate, Settlement Rule, Collateral Token, and PriceEngine Version.

*Source: `docs/Protocol_Security_Standard.md`*

---

## 4. Market Rules

Pulse Protocol V1 supports two specific types of prediction markets (Views), as defined in the Factory registry:

### FIXED Market
-   **Rule:** Has a fixed `endTime`. Trading ceases and the market enters Settlement after `endTime` is reached.
-   **Constraint:** Must have a minimum duration to guarantee a valid settlement window (`endTime >= startTime + SETTLEMENT_WINDOW + MIN_TRADING_DURATION`).

*Source: `contracts/interfaces/IPulseFactory.sol`*

### PERMANENT Market
-   **Rule:** Has no `endTime` (`endTime == 0`). Never enters Settlement.
-   **Constraint:** Cannot be locked. The `TradingEngine.lockMarket` function explicitly rejects locking for PERMANENT markets. V1 prohibits automatic closure and defines no termination mechanism for PERMANENT markets.

*Source: `contracts/interfaces/IPulseFactory.sol`, `docs/Stage6_5_Security_Hardened_Report.md`*

---

## 5. Forbidden Actions

The following actions are explicitly forbidden and violate the V1 Constitution:

1.  **Architecture Violation:** Altering the established module boundaries (e.g., allowing FeeManager to hold funds, adding state to PriceEngine).
2.  **State Duplication:** Allowing two modules to maintain the same state (e.g., SettlementManager must not maintain its own copy of the market lifecycle state).
3.  **Fund Flow Alteration:** Modifying the rule that all physical ERC20 tokens reside solely in the MarketVault.
4.  **Math Vulnerability:** Using direct `a * b / c` arithmetic instead of full-precision `mulDiv` for critical calculations.
5.  **Unverified Changes:** Implementing modifications without completing the mandatory Functional, Boundary, Attack, and Economic testing categories.

*Source: `docs/Protocol_Security_Standard.md`, `docs/design/TradingEngine/TradingEngine_StateMachine.md`*

---

## 6. V1 Version Boundary

This Constitution exclusively governs Pulse Protocol V1. It does not encompass, anticipate, or constrain V2 concepts, future designs, or extended protocol scopes outside the Stage 6.5 Security Hardened baseline. Any future V1 development must be based solely on the `aess-code/pulse-protocol-v1` repository.

*Source: `docs/Stage6_5_Merge_Impact_Analysis.md`, `docs/Stage6_5_Security_Hardened_Report.md`*
