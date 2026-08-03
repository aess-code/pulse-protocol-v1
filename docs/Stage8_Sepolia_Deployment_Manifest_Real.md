# Pulse Protocol V1 — Stage 8 Sepolia Deployment Manifest (REAL)

本部署清单是 Pulse Protocol V1 在 Sepolia 测试网进行正式部署前的最终技术参数固化与完整性记录。所有信息均基于 RC1 冻结版本和真实的 Sepolia 部署环境。

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
| **Git Commit Hash** | `3eb374ba4ae2ee535e8ce3344ba763acef3de5c5` | **PASS** |
| **Git Tag** | `v1.0.0-rc1` | **PASS** |
| **`contracts/` 目录状态** | `nothing to commit, working tree clean` | **PASS** |
| **`test/` 目录状态** | `nothing to commit, working tree clean` | **PASS** |

## 3. Deployment Wallet

| 字段 | 值 | 用途 |
| :--- | :--- | :--- |
| **Deployer Address** | `0x65fDa4C36a7fd24cCCEA255778A089C3C57D12aA` | 真实 Sepolia 部署钱包。 |
| **Deployment Nonce** | `0` | 部署者账户的起始 Nonce。 |
| **Wallet Purpose** | 专用部署账户 | 确保资金充足且私钥安全。 |

## 4. Immutable Configuration

以下参数在部署后将作为合约的 `immutable` 状态，无法更改。

| 参数 | 描述 | 地址 |
| :--- | :--- | :--- |
| **Treasury Address** | 协议国库地址 (30%) | `0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db` |
| **Team Address** | 协议团队地址 (20%) | `0x78731D3Ca6b7E34aC0F824c42a7cC18A495cabaB` |
| **Settlement Token** | MockUSDT 地址 | **Pending MockUSDT Deployment** |

## 5. Expected Deployment Address Table (REAL ENVIRONMENT)

以下地址基于部署钱包 `0x65fDa4C36a7fd24cCCEA255778A089C3C57D12aA` 和 Nonce `0` 预测。

| Contract Name | Expected Address | Constructor Dependencies |
| :--- | :--- | :--- |
| **PriceEngine** | `0xb635Dfd9f1Caa20aE6732eD775F7278Ddf869D48` | None |
| **MarketVaultFactory** | `0xf3b24C4c047C9d2A41B2069Be3f5b4c8F767a603` | `0x3B11aa50A2253F7be5915Bc964c6d577d7425fCf` (PulseFactory) |
| **TradingEngine** | `0x629F74De30dD7c4eca6A48CB5549959697140e39` | PulseFactory, `0xb635Dfd9f1Caa20aE6732eD775F7278Ddf869D48` (PriceEngine), `0x3c5F57B9395265AA2D522E30Fad9064021F381e1` (FeeManager) |
| **FeeManager** | `0x3c5F57B9395265AA2D522E30Fad9064021F381e1` | `0x629F74De30dD7c4eca6A48CB5549959697140e39` (TradingEngine), PulseFactory, Treasury, Team |
| **SettlementManager** | `0x68E32bC3327Fc2417f05800190406AF8804301a9` | TradingEngine, PulseFactory |
| **PulseFactory** | `0x3B11aa50A2253F7be5915Bc964c6d577d7425fCf` | MarketVaultFactory, TradingEngine, SettlementManager, FeeManager, Settlement Token |

---
*Pulse Protocol Solidity Engineer*
*2026-08-01*
