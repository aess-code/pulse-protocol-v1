# Stage 6.5 Merge Impact Analysis Report

## 1. 差异分析概述
比较了 `pulse-protocol-v1` (Stage 5 官方基础仓库) 与 `v1pool@69f1026` (Stage 6.5 Security Hardened 版本)。差异集中在核心合约、接口定义以及测试套件上。

## 2. 需要合并的文件列表 (来自 v1pool@69f1026)

**Contracts:**
- `contracts/TradingEngine.sol` (滑点保护、永久市场锁定逻辑修复)
- `contracts/factory/PulseFactory.sol` (PriceEngine Snapshot 修复)
- `contracts/fee/FeeManager.sol` (Error Handling 改进)
- `contracts/settlement/SettlementManager.sol` (Error Handling 改进)
- `contracts/vault/MarketVault.sol` (Factory Deployment DoS 修复)
- `contracts/vault/MarketVaultFactory.sol` (传递 factory 地址)
- `contracts/test/MockVaultFactoryForIntegration.sol` (测试支持)

**Interfaces:**
- `contracts/interfaces/ITradingEngine.sol` (新增滑点参数、`priceEngine` 接口)
- `contracts/interfaces/IFeeManager.sol` (新增 `FeeManager__VaultNotFound`)
- `contracts/interfaces/ISettlementManager.sol` (新增 `Settlement__ZeroAddress`)

**Tests:**
- `test/Stage5Integration.test.cjs` (更新滑点参数)
- `test/TradingEngine.test.cjs` (更新滑点参数)
- `test/Stage6_5_Security.test.cjs` (新增安全回归测试)

*(注：差异报告中显示 `v1pool_stage65` 包含 `Market.sol`, `MarketFactory.sol`, `MathWrapper.sol`, `MockAttackTokens.sol` 以及一些早期阶段的测试文件。这些属于 V1 早期原型遗留文件，**不会**被合并到官方仓库中，以保持仓库纯洁性。)*

## 3. 必须保留的文件列表 (pulse-protocol-v1 现有)
- 所有 `docs/` 下的现有文档（架构设计、安全标准、Design Freeze、Stage 5 报告等）。
- 现有的 `package.json` 和 `hardhat.config.cjs` (已清理过依赖)。
- 未修改的合约（如 `MathLibrary.sol`, `TWAPLibrary.sol`, `PriceEngine.sol`）。

## 4. 潜在冲突位置
- **接口签名变更：** `ITradingEngine` 的 `buy` 和 `sell` 增加了滑点参数，这将导致所有依赖旧签名的测试报错。这已经在 Stage 6.5 的测试文件中修复，直接覆盖测试文件即可解决。
- **循环依赖初始化：** `PulseFactory` 与 `MarketVault` 的初始化逻辑有所调整，但均在 Stage 6.5 验证通过，直接覆盖不会引发新冲突。

## 5. 对 V1 架构的影响评估
**无架构漂移，无安全边界破坏。**
- **TradingEngine**：依然只负责交易流程编排，不接触资金。
- **MarketVault**：依然是唯一资产托管层，`setFeeManager` 的权限放宽仅限于 Factory 初始化阶段，不增加任何管理员提款或隐藏权限。
- **FeeManager**：依然纯记账，不持有 ERC20。
- **PriceEngine**：依然无状态纯计算。

## 结论
本次合并**严格遵守** V1 架构边界冻结要求，仅涉及 Stage 6.5 已验证的安全强化代码，不会引入无关文件或前端代码。

等待确认后，将执行合并。
