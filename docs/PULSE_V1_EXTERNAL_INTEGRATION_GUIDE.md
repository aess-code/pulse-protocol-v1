# Pulse Protocol V1 External Integration Guide

## 1. Purpose

Explain how external applications integrate with Pulse V1 Core. 

Examples:
- Frontend applications
- Analytics systems
- Future external modules

---

## 2. External Module Principle

External modules **CAN**:
- call Core interfaces
- provide user experiences
- provide additional workflows

External modules **CANNOT**:
- modify Core logic
- bypass economic invariants
- change settlement rules
- change fee distribution
- bypass security boundaries

---

## 3. Market Creation Flow

**General flow:**
External Caller → PulseFactory → MarketVaultFactory → MarketVault → TradingEngine.initializeMarketState() → Active Market

Before activation, Core validates:
`YES Liquidity == NO Liquidity`

---

## 4. Trading Flow

**Buy:**
User → TradingEngine.buy() → PriceEngine → Position Update → Vault Accounting

**Sell:**
User → TradingEngine.sell() → Solvency Validation → Position Update → Reserve Release

---

## 5. Settlement Flow

TWAP Observation → SettlementManager → Winner Determination → Claim → Vault Payout

---

## 6. Future Module Boundary

Future application modules must remain external. They may use Core interfaces. They must not become part of Core.

---

## 7. Final Verification

After generating documents verify:
1. No Solidity changes.
2. No interface changes.
3. No test changes.
4. Frozen reference remains: `be73488`
5. Documentation release remains: `b333898`

**Final output:**
Pulse V1 Core Interface Freeze Completed.
Core Protocol remains unchanged.
