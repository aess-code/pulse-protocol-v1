# Pulse V1 Interface Documentation Update

**Frozen Baseline:** `be73488`
**Update Type:** NatSpec comment correction only
**File Modified:** `contracts/interfaces/ITradingEngine.sol`
**Solidity Logic Changed:** NO
**ABI Changed:** NO
**Events Changed:** NO
**Errors Changed:** NO
**Tests Changed:** NO

---

## Previous Inaccurate Statement

Located at `contracts/interfaces/ITradingEngine.sol`, `initializeMarketState()` NatSpec:

```
/// Core does NOT validate application-layer rules (e.g. 50/50 split, minimum deposit requirements).
```

---

## New Corrected Statement

```
/// Core enforces the Fair Launch Economic Invariant (Step 9):
///   - totalYesLiquidity == totalNoLiquidity (enforced via TradingEngine__AllocationMismatch)
/// This is a Core-level protocol invariant, NOT an application-layer rule.
/// External modules MUST satisfy this invariant before calling initializeMarketState().
///
/// Core does NOT validate application-layer concerns such as minimum deposit requirements.
/// Core does NOT understand Creator, GE, Builder, Launchpad, or any application concepts.
```

---

## Reason for Correction

In Step 9 (commit `be73488`), the following enforcement was added to `TradingEngine.initializeMarketState()`:

```solidity
if (totalYesLiquidity != totalNoLiquidity) revert TradingEngine__AllocationMismatch();
```

This makes `totalYesLiquidity == totalNoLiquidity` a **Core-enforced protocol invariant**, not an application-layer concern. The previous NatSpec comment was written before Step 9 and was not updated at that time, creating a documentation inconsistency.

The correction aligns the interface documentation with the actual frozen implementation at `be73488`.

---

## Confirmation That Core Behavior Is Unchanged

This update modifies only NatSpec comments. The Solidity logic, function signatures, events, errors, and storage layout are entirely unchanged.

The `TradingEngine__AllocationMismatch` error and the 50/50 enforcement at line 518 of `TradingEngine.sol` were already present in `be73488` and remain unchanged.

`be73488` remains the immutable Pulse V1 Core Protocol Freeze Baseline.
