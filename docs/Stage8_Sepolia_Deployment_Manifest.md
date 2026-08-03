# Pulse Protocol V1 — Stage 8 Sepolia Deployment Manifest

本部署清单是 Pulse Protocol V1 在 Sepolia 测试网进行正式部署前的最终技术参数固化与完整性记录。所有信息均基于 RC1 冻结版本和 Stage 8 部署准备阶段的成果。

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
| **`contracts/` 目录状态** | `nothing to commit, working tree clean` | **PASS** | 确认核心合约文件未被修改。 |
| **`test/` 目录状态** | `nothing to commit, working tree clean` | **PASS** | 确认测试文件未被修改。 |

## 3. Deployment Wallet

| 字段 | 值 | 用途 |
| :--- | :--- | :--- |
| **Deployer Address** | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | 用于签署和发送所有合约部署交易。 |
| **Deployment Nonce** | `0` | 部署者账户的起始 Nonce，用于地址预测。 |
| **Wallet Purpose** | 专用部署账户 | 建议使用独立账户，确保资金充足且私钥安全。 |

## 4. Immutable Configuration

以下参数在部署后将作为合约的 `immutable` 状态，无法更改。部署前务必仔细核对。

| 参数 | 描述 | 部署后不可修改 |
| :--- | :--- | :--- |
| **Treasury Address** | 协议国库地址，接收 30% 协议费用。 | **是** |
| **Team Address** | 协议团队地址，接收 20% 协议费用。 | **是** |
| **Settlement Token Address** | 协议使用的 ERC20 结算代币地址。 | **是** |

## 5. Expected Deployment Address Table

以下地址是基于当前部署者账户 (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`) 和起始 Nonce (`0`) 通过 `scripts/dry-run.cjs` 预测的合约地址。实际部署时，如果 Nonce 保持一致，合约将部署到这些地址。

| Contract Name | Expected Address | Constructor Dependencies |
| :--- | :--- | :--- |
| **PriceEngine** | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | None |
| **MarketVaultFactory** | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` | `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707` (PulseFactory) |
| **TradingEngine** | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` | PulseFactory, `0x5FbDB2315678afecb367f032d93F642f64180aa3` (PriceEngine), `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` (FeeManager) |
| **FeeManager** | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` (TradingEngine), PulseFactory, `0xTREASURY_PLACEHOLDER`, `0xTEAM_PLACEHOLDER` |
| **SettlementManager** | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` | TradingEngine, PulseFactory |
| **PulseFactory** | `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707` | MarketVaultFactory, TradingEngine, SettlementManager, FeeManager, Settlement Token |

## 6. Deployment Checklist

### Before Deployment (部署前)

- [ ] **`.env` 检查**: 确认 `PRIVATE_KEY`, `SEPOLIA_RPC_URL`, `TREASURY_ADDRESS`, `TEAM_ADDRESS`, `SETTLEMENT_TOKEN_ADDRESS` 已正确配置。
- [ ] **Sepolia ETH 检查**: 部署者钱包拥有足够的 Sepolia ETH 支付所有部署交易的 Gas 费用。
- [ ] **MockUSDT 部署确认**: 如果尚未部署，先运行 `scripts/deploy-mock-usdt.cjs` 并在 `.env` 中更新 `SETTLEMENT_TOKEN_ADDRESS`。
- [ ] **`dry-run.cjs` 通过**: 运行 `npx hardhat run scripts/dry-run.cjs`，并人工核对输出的地址表与本清单一致。

### Deployment (部署中)

- [ ] **部署 MockUSDT**: 如果需要，运行 `npx hardhat run scripts/deploy-mock-usdt.cjs --network sepolia`。
- [ ] **部署核心协议**: 运行 `npx hardhat run scripts/deploy-sepolia.cjs --network sepolia`。

### After Deployment (部署后)

- [ ] **地址一致性检查**: 核对 `deploy-sepolia.cjs` 输出的实际部署地址与 `dry-run.cjs` 预测的地址是否完全一致。
- [ ] **Immutable 参数检查**: 通过链上查询验证所有核心合约的 `immutable` 构造函数参数是否正确注入。
- [ ] **Factory 创建 View**: 成功调用 `PulseFactory.createView()` 创建一个测试市场，并验证 `MarketVault` 部署和 `FeeManager` 授权。
- [ ] **Buy/Sell 测试**: 在测试市场中成功执行买入和卖出操作。
- [ ] **Lock**: 成功调用 `TradingEngine.lockMarket()` 锁定市场。
- [ ] **Settlement**: 成功调用 `SettlementManager.settleMarket()` 结算市场。
- [ ] **Claim**: 成功调用 `SettlementManager.claimReward()` 领取奖励。
- [ ] **Fee Claim**: 成功调用 `FeeManager.claimCreatorFee()`, `claimTreasuryFee()`, `claimTeamFee()` 领取费用。

---
*Pulse Protocol Solidity Engineer*
*2026-08-01*
