# Pulse Protocol V1 Sepolia Deployment Result

**Network:** Ethereum Sepolia (`11155111`)
**Deployer Address:** `0x0B2141b7F564bf0Be428188c9Ba0D5De4e41342B`
**Status:** **SUCCESS**

---

## 1. Deployed Contracts

All 6 core contracts have been successfully deployed to the Sepolia testnet. The actual addresses perfectly match the predicted addresses from the Dry Run.

| Contract Name | Deployed Address | Status |
| :--- | :--- | :--- |
| **PriceEngine** | `0x70A91100f52D09b021ba28B607A534ED94e3986d` | **PASS** |
| **MarketVaultFactory** | `0x9F9d076cdE441EeCeD011CAF0F18f2a3a48274A8` | **PASS** |
| **TradingEngine** | `0xa6EE88f610140c9934153fC0d3549930a8f60B91` | **PASS** |
| **FeeManager** | `0xE15FF88dB39740a7B9E46e69712F0Ad4a288dbe7` | **PASS** |
| **SettlementManager** | `0xB73abD77372FcD9E2Ca1D93d64A5d8163F24cC1e` | **PASS** |
| **PulseFactory** | `0x0e7592aF466DE837B700a97909E73cDF74E26D93` | **PASS** |

---

## 2. Immutable Links Verification

A post-deployment verification script (`scripts/verify-deployment.cjs`) was executed to confirm that all circular dependencies and immutable state variables were correctly wired.

| Verification Check | Result |
| :--- | :--- |
| `PulseFactory.tradingEngine()` | **PASS** |
| `PulseFactory.feeManager()` | **PASS** |
| `PulseFactory.settlementManager()` | **PASS** |
| `PulseFactory.vaultFactory()` | **PASS** |
| `TradingEngine.factory()` | **PASS** |
| `TradingEngine.feeManager()` | **PASS** |
| `TradingEngine.priceEngine()` | **PASS** |
| `FeeManager.authorizedTradingEngine()` | **PASS** |
| `FeeManager.factory()` | **PASS** |
| `MarketVaultFactory.authorizedFactory()` | **PASS** |
| `SettlementManager.tradingEngine()` | **PASS** |
| `SettlementManager.factory()` | **PASS** |

**Conclusion:** The Core Protocol is correctly wired. All internal module pointers are strictly bound to the deployed addresses.

---

## 3. Economic Parameters Verification

The following economic parameters were verified on-chain post-deployment:

| Parameter | On-Chain Value | Status |
| :--- | :--- | :--- |
| **MIN_INITIAL_LIQUIDITY** | `100000000` (100 MockUSDT) | **PASS** |
| **Settlement Token** | `0xDE92b9aF7FCd57ad660d7098C6a125D6594aA243` | **PASS** |
| **Treasury Address** | `0x1B84E2581949CC26C5BE97E701905881fD693201` | **PASS** |
| **Team Address** | `0xbbc1f05D0478815776AAA2e1E13155030Bb04bd3` | **PASS** |

---

## 4. Next Steps

The Pulse Protocol V1 Core is now fully live on the Sepolia testnet.
You can now proceed with integration testing, including:
- Calling `PulseFactory.createView()` to create the first test market.
- Approving MockUSDT and calling `TradingEngine.buy()`.
- Verifying the TWAP and settlement flow.

*Pulse Protocol Solidity Engineer*
*2026-08-03*
