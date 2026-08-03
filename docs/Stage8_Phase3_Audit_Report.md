# Pulse Protocol V1 — Stage 8 Phase 3 Deployment Verification Audit Report

## 1. 部署脚本审查 (`scripts/deploy-sepolia.cjs`)

### 1.1 部署顺序与依赖关系

| 步骤 | 合约 | 依赖项 (构造函数参数) | 部署顺序检查 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `PriceEngine` | 无 | **PASS** | 独立部署，无前置依赖。 |
| 2 | `MarketVaultFactory` | `pulseFactoryAddr` (预测) | **PASS** | 依赖 `PulseFactory` 的预测地址。 |
| 3 | `TradingEngine` | `pulseFactoryAddr` (预测), `priceEngineAddr` (实际), `feeManagerAddr` (预测) | **PASS** | 依赖 `PulseFactory` 和 `FeeManager` 的预测地址，以及 `PriceEngine` 的实际地址。 |
| 4 | `FeeManager` | `tradingEngineAddr` (预测), `pulseFactoryAddr` (预测), `TREASURY_ADDRESS`, `TEAM_ADDRESS` | **PASS** | 依赖 `TradingEngine` 和 `PulseFactory` 的预测地址，以及外部配置的 Treasury 和 Team 地址。 |
| 5 | `SettlementManager` | `tradingEngineAddr` (预测), `pulseFactoryAddr` (预测) | **PASS** | 依赖 `TradingEngine` 和 `PulseFactory` 的预测地址。 |
| 6 | `PulseFactory` | `marketVaultFactoryAddr` (实际), `tradingEngineAddr` (实际), `settlementManagerAddr` (实际), `feeManagerAddr` (实际), `SETTLEMENT_TOKEN_ADDRESS` | **PASS** | 依赖所有已部署模块的实际地址，以及外部配置的 Settlement Token 地址。 |

**结论**: 部署顺序严格遵循 `Stage8_Deployment_Architecture.md` 中定义的依赖关系，通过 Hardhat 的 `ethers.getCreateAddress` 进行 Nonce-based 地址预测，有效解决了模块间的循环依赖问题。

### 1.2 Nonce 计算与风险

- **Nonce 计算**: 脚本通过 `deployer.getNonce()` 获取起始 Nonce，并按部署顺序递增 `startNonce + N` 来预测地址。这是 Hardhat 环境下进行确定性部署的标准方法。
- **风险**: 如果部署过程中任何交易失败（例如，Gas 不足、RPC 连接中断），导致部署者账户的 Nonce 意外递增，则后续所有预测地址将失效，导致部署失败。脚本本身不具备自动重试或 Nonce 回滚机制。
- **遗漏初始化步骤**: 核心模块的初始化（如 `MarketVault.setFeeManager`）是在 `PulseFactory.createView()` 内部完成的，而不是在部署脚本中单独执行。这符合协议的“Factory 作为协调者”的设计，且 `MarketVault` 的 `setFeeManager` 方法允许 `Factory` 调用，避免了部署后的额外授权步骤。因此，部署脚本中没有遗漏核心模块的初始化步骤。

## 2. Dry Run 审查 (`scripts/dry-run.cjs`)

- **地址一致性**: `dry-run.cjs` 脚本与 `deploy-sepolia.cjs` 脚本使用相同的 `predictAddress` 逻辑和 Nonce 递增规则。因此，在相同的起始 Nonce 和部署者地址下，`dry-run.cjs` 预测的地址与 `deploy-sepolia.cjs` 实际部署的地址（如果部署成功）将完全一致。
- **依赖错误发现**: `dry-run.cjs` 能够提前模拟构造函数参数的注入，并在控制台输出依赖关系，有助于在实际部署前发现潜在的配置错误或地址错位问题。
- **核心模块覆盖**: `dry-run.cjs` 包含了所有 6 个核心模块的地址预测和依赖检查。

## 3. 配置审查 (`hardhat.config.cjs`)

| 配置项 | 审查结果 | 状态 | 备注 |
| :--- | :--- | :--- | :--- |
| **Solidity 版本** | `0.8.24` | **PASS** | 符合 RC1 冻结版本要求。 |
| **Optimizer** | `enabled: true, runs: 200` | **PASS** | 符合协议性能优化标准。 |
| **viaIR** | `true` | **PASS** | 开启 IR 优化，提高代码效率。 |
| **EVM 版本** | `cancun` | **PASS** | 目标 EVM 版本正确。 |
| **Sepolia 网络配置** | `url: process.env.SEPOLIA_RPC_URL`, `accounts: [process.env.PRIVATE_KEY]` | **PASS** | 使用环境变量安全配置 RPC URL 和私钥，避免硬编码。 |
| **环境变量读取** | `require("dotenv").config();` | **PASS** | 使用 `dotenv` 库加载 `.env` 文件，标准且安全。 |

## 4. 参数审查 (Treasury, Team, Settlement Token)

- **Treasury 地址**: 在 `FeeManager` 构造函数中作为 `immutable` 参数传入，从 `process.env.TREASURY_ADDRESS` 读取。符合 V1 Freeze 中费用接收者地址不可更改的要求。
- **Team 地址**: 在 `FeeManager` 构造函数中作为 `immutable` 参数传入，从 `process.env.TEAM_ADDRESS` 读取。符合 V1 Freeze 中费用接收者地址不可更改的要求。
- **Settlement Token 地址**: 在 `PulseFactory` 构造函数中作为 `immutable` 参数传入，从 `process.env.SETTLEMENT_TOKEN_ADDRESS` 读取。符合 V1 Freeze 中结算代币不可更改的要求。
- **合规性**: 所有关键参数均通过环境变量注入，并在合约构造函数中设置为 `immutable`，确保了协议的不可变性和安全性，符合 V1 Freeze 的要求。

## 5. 部署风险清单

### A. 可以直接部署项 (Ready for Deployment)

- **`PriceEngine`**: 独立模块，无外部依赖，可直接部署。
- **Hardhat 配置**: `hardhat.config.cjs` 已正确配置，支持 Sepolia 网络和环境变量。
- **部署脚本结构**: `deploy-sepolia.cjs` 和 `dry-run.cjs` 的逻辑结构清晰，符合部署顺序和依赖关系。

### B. 必须人工确认项 (Requires Manual Confirmation)

- **环境变量配置**: 部署前必须确保 `.env` 文件中的 `PRIVATE_KEY`, `SEPOLIA_RPC_URL`, `TREASURY_ADDRESS`, `TEAM_ADDRESS`, `SETTLEMENT_TOKEN_ADDRESS` 已正确配置，且 `PRIVATE_KEY` 对应的账户有足够的 Sepolia ETH。
- **预测地址与实际地址核对**: 部署后，必须仔细核对 `deploy-sepolia.cjs` 输出的实际部署地址与 `dry-run.cjs` 预测的地址是否完全一致。任何不一致都意味着部署失败。
- **构造函数参数验证**: 部署后，通过链上查询（如 Etherscan 或 Hardhat Console）验证所有合约的 `immutable` 构造函数参数是否正确注入。

### C. 潜在风险项 (Potential Risks)

- **Nonce 错位**: 如果部署过程中任何交易失败，导致部署者账户的 Nonce 意外递增，将导致后续合约的预测地址与实际部署地址不符，从而使整个协议部署失败。**解决方案**: 部署失败后，必须放弃当前部署，并从头开始一个新的部署流程，确保使用新的部署者 Nonce。
- **Gas 波动**: Sepolia 网络 Gas 价格波动可能导致交易失败。**解决方案**: 建议在 Gas 价格相对稳定时进行部署，并确保部署者钱包有充足的 Gas 储备。
- **RPC 服务中断**: RPC 节点不稳定可能导致部署交易无法发送或状态不同步。**解决方案**: 使用可靠的 RPC 服务提供商，并在部署前测试连接稳定性。
- **Settlement Token 地址错误**: 如果 `SETTLEMENT_TOKEN_ADDRESS` 配置错误（例如，指向了非 ERC20 合约或错误的 ERC20 合约），将导致 `PulseFactory` 无法正常工作，且 `MarketVault` 的资金流将出现问题。**解决方案**: 部署前务必双重核对 Settlement Token 的地址。

## 6. 最终结论

1.  **当前部署脚本是否可以用于 Sepolia？**
    **是**。`scripts/deploy-sepolia.cjs` 脚本在逻辑上是健全的，它遵循了协议的部署顺序和依赖关系，并利用 Nonce-based 地址预测解决了循环依赖问题。配合 `.env` 文件进行参数配置，可以用于 Sepolia 测试网的部署。

2.  **是否存在会导致资金安全风险的问题？**
    **否**。在脚本层面，没有发现直接导致资金安全风险的问题。所有关键参数（Treasury, Team, Settlement Token）均设置为 `immutable`，并通过环境变量安全注入。合约本身已通过 RC1 冻结和安全审计，且 `MarketVault` 具有严格的资金隔离和不变性校验。主要的风险在于**部署过程中的操作失误**（如 Nonce 错位、参数配置错误），而非脚本或合约本身的漏洞。

3.  **是否可以进入 Stage 8 Phase 4 正式测试网部署？**
    **是**。经过本次详细审计，部署基础设施已准备就绪，并且通过了本地测试验证。在确保所有人工确认项（特别是 `.env` 配置）无误的前提下，可以进入 Stage 8 Phase 4 的 Sepolia 测试网部署阶段。

---
*Pulse Protocol Solidity Engineer*
*2026-08-01*
