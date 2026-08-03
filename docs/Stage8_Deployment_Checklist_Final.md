# Pulse Protocol V1 — Stage 8 Deployment Checklist

## 1. Pre-Deployment Verification

### 1.1 Code & Build
- [ ] **Repository Status**: Current branch is `main`, tag is `v1.0.0-rc1`.
- [ ] **Clean Build**: `pnpm run clean && pnpm run compile` executed successfully.
- [ ] **Test Status**: `pnpm run test` passes with 145/145 tests.
- [ ] **Compiler Settings**: Solidity 0.8.24, Optimizer: 200 runs, EVM: Cancun.

### 1.2 Environment & Wallets
- [ ] **Network**: Target network (Sepolia/Mainnet) is correctly configured in `hardhat.config.cjs`.
- [ ] **Deployer Wallet**: Nonce is verified; balance is sufficient for the full sequence.
- [ ] **Treasury Address**: Confirmed (Gnosis Safe for Mainnet).
- [ ] **Team Address**: Confirmed (Gnosis Safe for Mainnet).
- [ ] **Settlement Token**: Official ERC20 address for the target network is confirmed.

---

## 2. Deployment Execution

### 2.1 Sequence
- [ ] **Address Prediction**: Predicted addresses for all 6 core modules match the final deployment script.
- [ ] **Step 1**: `PriceEngine` deployed.
- [ ] **Step 2**: `MarketVaultFactory` deployed (linked to predicted `PulseFactory`).
- [ ] **Step 3**: `TradingEngine` deployed (linked to predicted `PulseFactory`, `PriceEngine`, `FeeManager`).
- [ ] **Step 4**: `FeeManager` deployed (linked to predicted `TradingEngine`, `PulseFactory`).
- [ ] **Step 5**: `SettlementManager` deployed (linked to predicted `TradingEngine`, `PulseFactory`).
- [ ] **Step 6**: `PulseFactory` deployed (linked to all previous modules).

### 2.2 Verification
- [ ] **Source Verification**: All 6 contracts verified on Etherscan/Explorer.
- [ ] **Dependency Audit**: Manual check of constructor arguments on-chain matches the prediction.

---

## 3. Post-Deployment Validation

### 3.1 Wiring Check
- [ ] `PulseFactory.tradingEngine()` returns the correct address.
- [ ] `TradingEngine.priceEngine()` returns the correct address.
- [ ] `FeeManager.treasury()` returns the correct address.

### 3.2 Smoke Tests
- [ ] **Market Creation**: Successfully created a test View.
- [ ] **Vault Authorization**: `vault.authorizedTradingEngine()` and `vault.authorizedFeeManager()` are correct.
- [ ] **Trade Execution**: Successfully performed a `buy` and `sell` transaction.
- [ ] **Lifecycle Transition**: Successfully `lock` and `settle` the test market.

---

## 4. Final Sign-off

- [ ] **Security Review**: No anomalies detected during smoke tests.
- [ ] **Gas Review**: Deployment and operational gas costs are within expected ranges.
- [ ] **Artifacts**: All deployment addresses and ABIs are recorded in the `deployments/` folder.

**Deployment Lead Signature:** ____________________  
**Date:** 2026-08-01
