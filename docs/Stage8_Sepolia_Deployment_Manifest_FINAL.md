# Pulse Protocol V1 — Stage 8 Sepolia Deployment Manifest (FINAL)

本部署清单是 Pulse Protocol V1 在 Sepolia 测试网进行正式部署前的最终技术参数固化与完整性记录。所有信息均基于真实的 Sepolia 部署环境。

## 1. Protocol Identity

| 字段 | 值 |
| :--- | :--- |
| **Protocol Name** | Pulse Protocol V1 |
| **Version** | v1.0.0-rc1 |
| **Network** | Ethereum Sepolia |
| **Chain ID** | 11155111 |

## 2. Source Integrity

| 字段 | 值 | 状态 |
| :--- | :--- | :--- |
| **Frozen Core Commit** | `be73488` | **PASS** |
| **Documentation Head** | `5cbc6b9` | **PASS** |
| **`contracts/` Diff** | `0 lines changed` | **PASS** |
| **`test/` Diff** | `0 lines changed` | **PASS** |
| **ABI Diff** | `0 signatures changed` | **PASS** |

## 3. Deployment Wallet

| 字段 | 值 |
| :--- | :--- |
| **Deployer Address** | `0x0B2141b7F564bf0Be428188c9Ba0D5De4e41342B` |
| **Current Nonce** | `48` |
| **Wallet Purpose** | Sepolia 专用部署账户 |

## 4. Immutable Configuration

以下参数在部署后将作为合约的 `immutable` 状态，无法更改。

| 参数 | 描述 | 地址 / 值 |
| :--- | :--- | :--- |
| **Treasury Address** | 协议国库地址 (20% fee) | `0x1b84e2581949cc26c5be97e701905881fd693201` |
| **Team Address** | 协议团队地址 (10% fee) | `0xbbc1f05d0478815776aaa2e1e13155030bb04bd3` |
| **Settlement Token** | MockUSDT (6 decimals) | `0xDE92b9aF7FCd57ad660d7098C6a125D6594aA243` |
| **MIN_INITIAL_LIQUIDITY** | 最小初始流动性要求 | `100000000` (100 MockUSDT) |

## 5. Expected Deployment Address Table

以下地址基于真实的部署钱包 `0x0B2141b7F564bf0Be428188c9Ba0D5De4e41342B` 和 Nonce `48` 预测。

| Contract Name | Expected Address | Constructor Dependencies |
| :--- | :--- | :--- |
| **PriceEngine** | `0x70A91100f52D09b021ba28B607A534ED94e3986d` | None |
| **MarketVaultFactory** | `0x9F9d076cdE441EeCeD011CAF0F18f2a3a48274A8` | `0x0e7592aF466DE837B700a97909E73cDF74E26D93` (PulseFactory) |
| **TradingEngine** | `0xa6EE88f610140c9934153fC0d3549930a8f60B91` | PulseFactory, `0x70A91100f52D09b021ba28B607A534ED94e3986d` (PriceEngine), `0xE15FF88dB39740a7B9E46e69712F0Ad4a288dbe7` (FeeManager) |
| **FeeManager** | `0xE15FF88dB39740a7B9E46e69712F0Ad4a288dbe7` | `0xa6EE88f610140c9934153fC0d3549930a8f60B91` (TradingEngine), PulseFactory, Treasury, Team |
| **SettlementManager** | `0xB73abD77372FcD9E2Ca1D93d64A5d8163F24cC1e` | TradingEngine, PulseFactory |
| **PulseFactory** | `0x0e7592aF466DE837B700a97909E73cDF74E26D93` | MarketVaultFactory, TradingEngine, SettlementManager, FeeManager, Settlement Token, MinLiquidity |

---
*Pulse Protocol Solidity Engineer*
*2026-08-03*
