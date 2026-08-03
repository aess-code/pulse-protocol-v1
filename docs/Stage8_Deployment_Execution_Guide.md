# Pulse Protocol V1 — Stage 8 Deployment Execution Guide

This guide outlines the step-by-step process for deploying Pulse Protocol V1 to the Sepolia testnet. It assumes the deployment environment has been prepared as per the `Stage8_Operations_Runbook.md` and the deployment scripts are in place.

## 1. Sepolia 钱包准备 (Sepolia Wallet Preparation)

### 1.1 部署者钱包 (Deployer Wallet)
- **目的**: 用于签署和发送部署交易的以太坊账户。
- **要求**: 确保该钱包拥有足够的 Sepolia ETH 来支付所有合约部署的 Gas 费用。
- **操作**: 准备一个私钥，并将其安全地存储在本地 `.env` 文件中。

### 1.2 费用接收者钱包 (Fee Recipient Wallets)
- **目的**: 接收协议费用分配的钱包地址。
- **要求**: 准备 Treasury 和 Team 的以太坊地址。对于 Sepolia 测试，可以使用普通 EOA 地址；对于主网部署，强烈建议使用多签钱包（如 Gnosis Safe）。
- **操作**: 准备 Treasury 和 Team 的地址，并将其安全地存储在本地 `.env` 文件中。

## 2. RPC 配置 (RPC Configuration)

### 2.1 获取 Sepolia RPC URL
- **目的**: 连接到 Sepolia 测试网络的节点。
- **操作**: 从可靠的 RPC 提供商（如 Alchemy, Infura, QuickNode）获取 Sepolia 网络 RPC URL。
- **配置**: 将 RPC URL 存储在本地 `.env` 文件中。

### 2.2 Hardhat 配置 (hardhat.config.cjs)
- **目的**: 确保 Hardhat 能够正确识别和连接 Sepolia 网络。
- **状态**: `hardhat.config.cjs` 已更新，包含 `sepolia` 网络配置，并通过 `dotenv` 从环境变量读取 `SEPOLIA_RPC_URL` 和 `PRIVATE_KEY`。

## 3. 环境变量配置 (Environment Variable Configuration)

在项目根目录下创建 `.env` 文件（如果尚未创建），并填入以下变量：

```dotenv
PRIVATE_KEY="YOUR_DEPLOYER_PRIVATE_KEY_HERE"
SEPOLIA_RPC_URL="YOUR_SEPOLIA_RPC_URL_HERE"
TREASURY_ADDRESS="0x..." # Sepolia Treasury Address
TEAM_ADDRESS="0x..."     # Sepolia Team Address
SETTLEMENT_TOKEN_ADDRESS="0x..." # Sepolia MockUSDT or actual USDT/USDC address
```

- **注意**: `PRIVATE_KEY` 必须是部署者钱包的私钥，以 `0x` 开头。
- **注意**: `SETTLEMENT_TOKEN_ADDRESS` 在 Sepolia 上应指向部署的 MockUSDT 合约地址。

## 4. 部署命令 (Deployment Commands)

### 4.1 Dry Run 模式 (地址预测)
- **目的**: 在实际部署前，模拟合约部署顺序并预测所有合约的最终地址，验证依赖关系。
- **命令**: 
    ```bash
    cd pulse-protocol-v1
    npx hardhat run scripts/dry-run.cjs
    ```
- **预期输出**: 一个包含所有核心合约预测地址、构造函数参数和依赖检查的表格。

### 4.2 Sepolia 部署 (Dry Run Only - No Transaction)
- **目的**: 模拟在 Sepolia 网络上的部署流程，但**不发送实际交易**。此脚本将打印出部署顺序和预测地址。
- **命令**: 
    ```bash
    cd pulse-protocol-v1
    npx hardhat run scripts/deploy-sepolia.cjs --network hardhat
    ```
- **注意**: `deploy-sepolia.cjs` 脚本本身包含了部署逻辑，但为了遵守“不发送链上交易”的限制，我们通过 `--network hardhat` 在本地 Hardhat 网络上运行它，以模拟部署过程并验证脚本逻辑。

## 5. 验证命令 (Verification Commands)

### 5.1 本地编译 (Local Compilation)
- **目的**: 确保所有合约能够成功编译。
- **命令**: 
    ```bash
    cd pulse-protocol-v1
    pnpm run compile
    ```
- **预期结果**: 所有 Solidity 文件成功编译，无错误。

### 5.2 本地测试 (Local Testing)
- **目的**: 确保所有测试用例通过，验证协议逻辑的正确性。
- **命令**: 
    ```bash
    cd pulse-protocol-v1
    pnpm run test
    ```
- **预期结果**: `145/145 tests passed`。

## 6. 回滚处理 (Rollback Handling)

由于 Pulse Protocol V1 采用不可变合约设计，一旦部署，合约代码无法更改。因此，没有传统的“回滚”机制。

- **部署失败**: 如果部署过程中任何一步失败（例如，交易失败、地址预测不匹配），则整个部署被视为无效。必须**放弃当前部署**，并从头开始一个新的部署流程，确保使用新的部署者 Nonce。
- **错误配置**: 如果合约部署后发现配置错误（例如，错误的 Treasury 地址），则该部署的合约将无法按预期工作。唯一的解决方案是**重新部署一套新的合约**，并确保所有参数正确。

## 7. 部署后检查 (Post-Deployment Checks)

在成功模拟部署后，需要进行以下检查以确保协议的完整性：

- **合约地址验证**: 确认 `deploy-sepolia.cjs` 输出的实际部署地址与 `dry-run.cjs` 预测的地址一致。
- **依赖关系验证**: 调用 `PulseFactory` 的 `tradingEngine()`、`MarketVaultFactory` 的 `authorizedFactory()` 等视图函数，确认所有模块的相互引用地址正确。
- **测试市场创建**: 模拟调用 `PulseFactory.createView()` 创建一个测试市场，并验证 `MarketVault` 是否被正确部署，且 `FeeManager` 是否被授权。
- **费用配置验证**: 确认 `FeeManager` 中配置的 `treasury` 和 `team` 地址正确。

---
*Pulse Protocol Solidity Engineer*
*2026-08-01*
