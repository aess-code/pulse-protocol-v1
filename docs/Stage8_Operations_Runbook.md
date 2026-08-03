# Pulse Protocol V1 — Stage 8 Operations Runbook

## Phase 1: Environment Preparation

### Purpose
Ensure the local development and deployment environment is consistent with the RC1 baseline.

### Steps
1.  **Clone Repository**: `git clone https://github.com/aess-code/pulse-protocol-v1.git`
2.  **Checkout RC1**: `git checkout v1.0.0-rc1`
3.  **Install Dependencies**: `pnpm install`
4.  **Compile Contracts**: `pnpm run compile`

### Acceptance Criteria
-   All contracts compile without warnings.
-   `artifacts/` folder contains the expected JSON files for all core modules.

---

## Phase 2: Wallet Preparation

### Purpose
Configure the deployment and operational wallets.

### Steps
1.  **Deployer Wallet**: Ensure a wallet with sufficient native gas tokens (ETH/Sepolia ETH) is available.
2.  **Treasury Wallet**: Define the address for protocol treasury (30% fees).
3.  **Team Wallet**: Define the address for the team (20% fees).
4.  **Security**: For Mainnet, Treasury and Team wallets MUST be multi-sig (e.g., Gnosis Safe).

### Acceptance Criteria
-   Deployer wallet address is recorded.
-   Treasury and Team addresses are confirmed.

---

## Phase 3: RPC Configuration

### Purpose
Set up the connection to the target network.

### Steps
1.  **Select Provider**: Use a reliable RPC provider (Alchemy, Infura, or a private node).
2.  **Configure Hardhat**: Update `hardhat.config.cjs` with the network URL and deployer private key (via environment variables).

### Acceptance Criteria
-   `npx hardhat network --network sepolia` returns the correct network information.

---

## Phase 4: Deployment Order

### Purpose
Execute the deterministic deployment sequence to resolve circular dependencies.

### Steps
1.  **Address Prediction**: Run the pre-deployment script to calculate future addresses for all core contracts based on the deployer's nonce.
2.  **Deploy PriceEngine**: No dependencies.
3.  **Deploy MarketVaultFactory**: Use the predicted PulseFactory address.
4.  **Deploy TradingEngine**: Use predicted Factory and FeeManager addresses.
5.  **Deploy FeeManager**: Use predicted TradingEngine and Factory addresses.
6.  **Deploy SettlementManager**: Use predicted TradingEngine and Factory addresses.
7.  **Deploy PulseFactory**: Use actual addresses of all deployed modules.

### Failure Handling
-   If any deployment fails, the nonce will be incremented. **Stop immediately**. All subsequent predicted addresses will be invalid. You must recalculate and restart the deployment.

---

## Phase 5: Initialization Order

### Purpose
Perform one-time protocol wiring.

### Steps
1.  **Verify Factory Ownership**: Ensure the `PulseFactory` has no "owner" or "admin" (as per V1 design).
2.  **Initial Market Creation**: Call `createView` with a test market to verify the atomic Vault deployment and FeeManager registration.

### Expected Result
-   A `ViewCreated` event is emitted.
-   A `MarketVault` is deployed.
-   `vault.authorizedFeeManager()` returns the FeeManager address.

---

## Phase 6: Contract Verification

### Purpose
Ensure transparency and source code availability on Etherscan.

### Steps
1.  **Verify All Contracts**: Use `npx hardhat verify --network <network> <address> <constructor-args>`.
2.  **Verify Library Linking**: Ensure `MathLibrary` and `TWAPLibrary` are correctly linked and verified.

### Acceptance Criteria
-   All contracts show a green checkmark on Etherscan/Sepolia Explorer.

---

## Phase 7: Smoke Testing

### Purpose
Confirm the live deployment is functional.

### Steps
1.  **Buy Shares**: Use a test user to `buy` FOR shares in the test market.
2.  **Sell Shares**: `sell` a portion of the shares to verify the PriceEngine and Vault withdrawal.
3.  **Lock Market**: Advance time (or wait) and call `lockMarket()`.
4.  **Settle Market**: Call `settleMarket()` and verify the winning outcome.
5.  **Claim Rewards**: Verify users can claim their payouts.

---

## Phase 8: Post-Deployment Validation

### Purpose
Final audit of the live state.

### Steps
1.  **Invariant Check**: Verify `Vault.balance() >= totalDeposits - totalWithdrawals`.
2.  **Fee Check**: Verify `FeeManager` correctly records the 1% fee from smoke tests.
3.  **Registry Check**: Confirm `PulseFactory.getView(1)` returns correct metadata and addresses.

---

## Phase 9: Emergency Recovery Procedures

### Purpose
Define actions for deployment failures.

### Procedures
1.  **Mismatched Addresses**: If a contract was deployed with a wrong dependency address, it is unusable. **Abandon the deployment** and start over with a new deployer nonce.
2.  **Gas Spike**: If gas prices spike during the sequence, wait for prices to stabilize. Do NOT skip steps or change the order.
3.  **Invariant Violation**: If a smoke test triggers a `Vault__InvariantViolation`, the deployment is considered compromised. Pause all operations and conduct a forensic audit of the deployment parameters.
