# Pulse V1 Sepolia Pre-Deployment Final Parameter Freeze

**Frozen Core Commit:** `be73488`
**Documentation Head:** `5cbc6b9`
**Network:** Ethereum Sepolia (Chain ID: 11155111)
**Status:** PARAMETER FREEZE — AWAITING HUMAN CONFIRMATION

---

## 1. Settlement Token

| 字段 | 值 |
| :--- | :--- |
| **Token Name** | MockUSDT |
| **Decimals** | `6` |
| **Sepolia Address** | **Pending Deployment** |
| **部署方式** | 执行 `scripts/deploy-mock-usdt.cjs --network sepolia` |

**重要说明：** MockUSDT 尚未在 Sepolia 上部署。其地址在部署完成后必须立即更新至 `.env` 的 `SETTLEMENT_TOKEN_ADDRESS` 字段，并在执行核心协议部署前完成确认。

---

## 2. MIN_INITIAL_LIQUIDITY

| 字段 | 值 |
| :--- | :--- |
| **最终部署值** | `100000000` |
| **单位** | MockUSDT 最小单位（6 decimals） |
| **等价金额** | 100 MockUSDT |
| **强制执行位置** | `PulseFactory` 构造函数（`immutable` 变量） |

**说明：** 该值为 `100 * 10^6 = 100,000,000`，即 100 MockUSDT。任何创建市场的调用，若 `totalYesLiquidity + totalNoLiquidity < 100000000`，将在核心层直接 Revert。

---

## 3. Fee Configuration

| 参数 | 值 | 来源 |
| :--- | :--- | :--- |
| **TOTAL_FEE_BPS** | `100` | `FeeManager.sol` 硬编码常量 |
| **FEE_RECIPIENT_SHARE_BPS** | `7000` | `FeeManager.sol` 硬编码常量 |
| **TREASURY_SHARE_BPS** | `2000` | `FeeManager.sol` 硬编码常量 |
| **TEAM_SHARE_BPS** | `1000` | `FeeManager.sol` 硬编码常量 |
| **BPS_DENOMINATOR** | `10000` | `FeeManager.sol` 硬编码常量 |

以上费用参数均为核心协议常量，**部署后不可修改**。

---

## 4. Initial Market Creation Rules

| 规则 | 值 | 强制执行位置 |
| :--- | :--- | :--- |
| **50/50 Invariant** | `totalYesLiquidity == totalNoLiquidity` | `TradingEngine.initializeMarketState()` |
| **Shares Formula** | `shares = liquidity * 2` | `TradingEngine._liquidityToShares()` |
| **INITIAL_INDEX** | `5000` | `MathLibrary.INITIAL_INDEX` |

---

## 5. Deployment Scope

本次 Sepolia V1 测试部署范围明确如下：

| 范围 | 状态 |
| :--- | :--- |
| **GE (Genesis Engine)** | **不包含** |
| **Launchpad** | **不包含** |
| **Creator 经济层** | **不包含** |
| **DAO 模块** | **不包含** |
| **市场创建入口** | 直接使用 Core `PulseFactory.createView()` |

本次测试仅验证 Pulse V1 Core 协议的基础功能，包括市场创建、交易、结算和费用领取。

---

## 6. Deployment Safety

| 检查项 | 状态 |
| :--- | :--- |
| **Contracts Logic Diff** | **ZERO** |
| **Test Diff** | **ZERO** |
| **ABI Diff** | **ZERO** |
| **NatSpec Diff** | 1 处（`ITradingEngine.sol`，仅注释更新，无 ABI 影响） |

---

## 7. 待确认项 (Pending Confirmation)

在进入 Phase 4B 正式部署前，以下项目需要人工确认：

| 待确认项 | 当前状态 | 操作 |
| :--- | :--- | :--- |
| **MockUSDT 部署** | Pending | 执行部署脚本并记录地址 |
| **SETTLEMENT_TOKEN_ADDRESS** | `0x000...000` | 更新 `.env` |
| **SEPOLIA_RPC_URL** | 占位符 | 填入真实 Alchemy/Infura URL |
| **Treasury 地址确认** | `0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db` | 人工确认 |
| **Team 地址确认** | `0x78731D3Ca6b7E34aC0F824c42a7cC18A495cabaB` | 人工确认 |

---

*Pulse Protocol Solidity Engineer*
*2026-08-03*
