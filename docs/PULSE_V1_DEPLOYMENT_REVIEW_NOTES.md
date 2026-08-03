# Pulse Protocol V1 — Deployment Documentation Review Notes

This document records inconsistencies identified during the Final Reconciliation Audit against the Frozen Core (Commit: `be73488`).

## 1. Fee Split Inconsistency

- **Issue:** The documentation specifies a fee split that does not match the frozen Solidity code.
- **Affected Document:** `docs/Economic_Model_Specification.md`
- **Code Value (`FeeManager.sol`):** 
    - `FEE_RECIPIENT_SHARE_BPS = 7000` (70%)
    - `TREASURY_SHARE_BPS = 2000` (20%)
    - `TEAM_SHARE_BPS = 1000` (10%)
- **Document Value:** 
    - Creator: 50%
    - Treasury: 30%
    - Team: 20%
- **Recommended Update:** Update the document to reflect the 70/20/10 split and replace the term "Creator" with the protocol-level abstraction "FeeRecipient".

## 2. Minimum Initial Liquidity Enforcement

- **Issue:** The documentation does not explicitly state that minimum initial liquidity is enforced at the Core Protocol level.
- **Affected Document:** `docs/PULSE_V1_DEPLOYMENT_GUIDE.md`
- **Code Reality:** `PulseFactory.sol` enforces `MIN_INITIAL_LIQUIDITY` as an immutable deployment parameter.
- **Recommended Update:** Change the description to: "Pulse V1 Core enforces minimum initial liquidity through immutable deployment configuration. Market creation will revert if total initial liquidity (YES + NO) is less than this value."

## 3. 50/50 Invariant Enforcement

- **Issue:** Some descriptive text implies the 50/50 initial liquidity split is an application-layer concern.
- **Affected Document:** `docs/PULSE_V1_DEVELOPER_API_REFERENCE.md` and `contracts/interfaces/IPulseFactory.sol` NatSpec.
- **Code Reality:** `TradingEngine.initializeMarketState()` strictly enforces `totalYesLiquidity == totalNoLiquidity` and reverts with `TradingEngine__AllocationMismatch` otherwise.
- **Recommended Update:** Ensure all documentation states: "The Fair Launch Economic Invariant (50/50 split) is strictly enforced by the Core Protocol during initialization."

## 4. Documentation Head Commit Reference

- **Issue:** The manifest files reference different Documentation Head commits.
- **Affected Document:** `docs/PULSE_V1_FINAL_REPOSITORY_STATE.md`
- **Observation:** The document references `4a4f39f` as the Documentation Head, but the current head is `5cbc6b9`.
- **Recommended Update:** Update the head commit reference to the latest verified documentation commit.
