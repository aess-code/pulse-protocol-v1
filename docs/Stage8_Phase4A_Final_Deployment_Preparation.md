# Pulse Protocol V1 — Stage 8 Phase 4A Final Deployment Preparation Report

本报告旨在对 Pulse Protocol V1 在 Sepolia 测试网的最终部署准备进行全面确认，确保所有环节均已就绪，并符合 RC1 冻结版本的各项要求。本阶段不涉及任何链上交易或代码修改。

## 1. 部署钱包检查 (Deployment Wallet Check)

| 钱包类型 | 用途说明 | 风险与注意事项 |
| :--- | :--- | :--- |
| **Deploy Wallet** | 用于签署和发送所有合约部署交易的账户。该账户的 Nonce 决定了合约的最终地址。 | 必须确保私钥安全，且拥有充足的 Sepolia ETH 用于支付 Gas 费用。任何部署失败都可能导致 Nonce 错位，需要重新开始部署流程。 |
| **Treasury Wallet** | `FeeManager` 合约中配置的协议国库地址，用于接收 30% 的协议费用。 | Sepolia 测试网可使用普通 EOA 地址。主网部署时，**强烈建议使用多签钱包（如 Gnosis Safe）**以增强安全性。该地址在 `FeeManager` 部署后不可更改。 |
| **Team Wallet** | `FeeManager` 合约中配置的团队地址，用于接收 20% 的协议费用。 | Sepolia 测试网可使用普通 EOA 地址。主网部署时，**强烈建议使用多签钱包（如 Gnosis Safe）**以增强安全性。该地址在 `FeeManager` 部署后不可更改。 |

## 2. 环境变量检查 (Environment Variable Check)

所有敏感信息和可配置参数均通过 `.env` 文件以环境变量形式注入，避免硬编码，增强了安全性。

| 环境变量 | 用途说明 | 风险与注意事项 |
| :--- | :--- | :--- |
| `PRIVATE_KEY` | 部署者钱包的私钥，用于签署交易。 | **极高风险**。必须严格保密，切勿泄露。建议使用专门的部署钱包，且仅在部署时加载。 |
| `SEPOLIA_RPC_URL` | Sepolia 测试网的 RPC 端点 URL。 | 确保 URL 有效且稳定。不稳定的 RPC 可能导致交易失败或状态不同步。 |
| `TREASURY_ADDRESS` | 协议国库的以太坊地址。 | 部署前务必核对地址的正确性。一旦部署，该地址在 `FeeManager` 中是不可变的。 |
| `TEAM_ADDRESS` | 协议团队的以太坊地址。 | 部署前务必核对地址的正确性。一旦部署，该地址在 `FeeManager` 中是不可变的。 |
| `SETTLEMENT_TOKEN_ADDRESS` | 用于协议结算的 ERC20 代币地址。 | Sepolia 测试网应使用 MockUSDT 的部署地址。主网部署时，应使用官方的稳定币（如 USDC, USDT）地址。该地址在 `PulseFactory` 部署后不可更改。 |

## 3. Settlement Token 方案确认 (Settlement Token Plan)

**Sepolia 测试网应使用 `MockUSDT` 作为结算代币。**

`MockUSDT.sol` 已存在于 `contracts/` 目录中，是一个标准的 ERC20 代币，具有 `mint` 功能，方便在测试网中模拟资金。

### MockUSDT 独立部署方案

为了确保 `PulseFactory` 部署时能引用正确的 `SETTLEMENT_TOKEN_ADDRESS`，`MockUSDT` 必须在核心协议合约之前部署。

1.  **创建部署脚本**: 已创建 `scripts/deploy-mock-usdt.cjs`。
2.  **执行部署**: 在 Sepolia 上运行 `scripts/deploy-mock-usdt.cjs`。
    ```bash
    cd pulse-protocol-v1
    npx hardhat run scripts/deploy-mock-usdt.cjs --network sepolia
    ```
3.  **记录地址**: 脚本将输出部署后的 `MockUSDT` 地址。将此地址更新到 `.env` 文件中的 `SETTLEMENT_TOKEN_ADDRESS` 变量。

**重要**: `MockUSDT` 的部署是独立于 Pulse 核心协议的，不会修改任何核心合约逻辑。

## 4. 部署前 Dry Run 流程 (Pre-Deployment Dry Run Flow)

完整的部署前 Dry Run 流程旨在通过本地模拟，验证部署脚本的正确性和地址预测的准确性，避免链上部署失败。

1.  **环境准备**: 确保 `.env` 文件已正确配置 `PRIVATE_KEY` 和 `SEPOLIA_RPC_URL`。
2.  **获取部署者 Nonce**: Hardhat 内部会自动获取部署者账户的当前 Nonce。
3.  **运行 `dry-run.cjs`**: 
    ```bash
    cd pulse-protocol-v1
    npx hardhat run scripts/dry-run.cjs
    ```
    - **目的**: 模拟合约部署顺序，并基于当前 Nonce 预测所有核心合约的地址。
    - **输出**: `Expected Deployment Address Table`，包含每个合约的预测地址、构造函数参数和依赖检查。
4.  **人工核对**: 仔细检查 `dry-run.cjs` 的输出，确保预测地址的顺序和依赖关系与 `Stage8_Deployment_Architecture.md` 中定义的完全一致。
5.  **运行 `deploy-sepolia.cjs` (本地模拟)**:
    ```bash
    cd pulse-protocol-v1
    npx hardhat run scripts/deploy-sepolia.cjs --network hardhat
    ```
    - **目的**: 在本地 Hardhat 网络上运行实际部署脚本，验证其逻辑流程和参数传递是否正确，但**不发送链上交易**。
    - **输出**: 模拟部署的日志，包括每个合约的“实际”部署地址（在本地 Hardhat 网络上）。
6.  **对比验证**: 将 `dry-run.cjs` 预测的地址与 `deploy-sepolia.cjs` (本地模拟) 输出的地址进行对比。两者应该完全一致。

## 5. 部署后验证流程 (Post-Deployment Verification Flow)

在 Sepolia 测试网完成核心协议合约部署后，必须执行以下验证步骤以确保协议的完整性和功能性。

1.  **记录核心合约地址**: 部署脚本 `deploy-sepolia.cjs` 将输出所有六个核心合约的实际部署地址。务必将这些地址妥善记录。
2.  **Immutable 参数检查**: 
    - 通过 Etherscan 或 Hardhat Console 调用每个核心合约的视图函数（如 `PulseFactory.tradingEngine()`, `FeeManager.treasury()`），验证其 `immutable` 构造函数参数是否正确指向了预期的地址。
    - 验证 `MarketVaultFactory.authorizedFactory()` 是否指向正确的 `PulseFactory` 地址。
3.  **Factory 创建 View**: 
    - 模拟调用 `PulseFactory.createView()` 创建一个测试市场（View）。
    - 验证 `ViewCreated` 事件是否被触发。
    - 验证 `MarketVault` 是否被正确部署，且其 `authorizedFeeManager()` 是否指向正确的 `FeeManager` 地址。
4.  **交易功能验证 (Buy/Sell)**: 
    - 使用测试账户在创建的 View 中执行 `buy` 操作。
    - 验证 `PulseIndex` 是否更新，`MarketVault` 是否收到资金，`FeeManager` 是否记录费用。
    - 执行 `sell` 操作，验证用户是否收到资金，费用是否正确扣除。
5.  **市场生命周期验证 (Lock/Settlement/Claim)**: 
    - 模拟时间推进，调用 `TradingEngine.lockMarket()`。
    - 验证市场状态是否变为 `LOCKED`，TWAP 是否最终确定。
    - 调用 `SettlementManager.settleMarket()`。
    - 验证市场状态是否变为 `CLAIMABLE`，结算结果是否正确。
    - 调用 `SettlementManager.claimReward()`，验证获胜者是否能领取奖励。
6.  **费用领取验证**: 
    - 验证 `FeeManager` 中的 `pendingCreatorFees`, `pendingTreasuryFees`, `pendingTeamFees` 是否有值。
    - 模拟调用 `FeeManager.claimCreatorFee()`, `claimTreasuryFee()`, `claimTeamFee()`，验证费用是否成功领取。

## 6. 最终回答 (Final Conclusion)

1.  **当前部署脚本是否可以用于 Sepolia？**
    **是**。经过全面的审查，`scripts/deploy-sepolia.cjs` 和 `scripts/dry-run.cjs` 已经过验证，并且 Hardhat 配置和环境变量注入方式也符合安全标准。配合 `scripts/deploy-mock-usdt.cjs` 部署 MockUSDT，整个部署基础设施已准备就绪。

2.  **是否可以进入 Stage 8 Phase 4B Sepolia 正式部署？**
    **是**。在确保所有环境变量（特别是 `PRIVATE_KEY`, `TREASURY_ADDRESS`, `TEAM_ADDRESS`, `SETTLEMENT_TOKEN_ADDRESS`）已正确配置，并且已执行完整的 Dry Run 流程并核对无误的前提下，可以安全地进入 Stage 8 Phase 4B Sepolia 正式部署阶段。

---
*Pulse Protocol Solidity Engineer*
*2026-08-01*
