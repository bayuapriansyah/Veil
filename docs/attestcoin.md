# VEIL x Attestcoin (Creditcoin USC) - How It Is Functionally Used

This is the deep-dive companion to the README's "How Attestcoin is functionally
used" section. It describes, precisely and without marketing, how VEIL uses
**Attestcoin** (the Universal State Consensus / USC primitive on Creditcoin) to
bring a source-chain fact (a payment event, a fulfillment event on Ethereum
Sepolia) to the settlement chain (Creditcoin CC3) as a **cryptographically
verified** fact.

Cross-reference: `ARCHITECTURE.md` (system view), `CONTRACTS.md` (ASC source
walkthrough), `TESTNET.md` (how to reproduce), `THREAT_MODEL.md` (trust
boundaries).

---

## 1. What Attestcoin provides (and what VEIL consumes)

Attestcoin is the name Creditcoin gives to its **universal cross-chain state
verification** feature. A source chain (Ethereum Sepolia in VEIL's case) has its
blocks attested on Creditcoin. Attestcoin lets a contract on Creditcoin prove
that a specific transaction was included in a specific attested block of a
source chain - without trusting a relayer or an oracle.

VEIL consumes exactly three primitives:

| Primitive | Real component VEIL uses | Role |
|---|---|---|
| Attested source-chain blocks | Creditcoin CC3 Testnet header chain (Sepolia chainKey = `1`) | a block becomes provable only after Creditcoin attests it |
| Proof generation | `ProofBuilder` service at `https://prover.cc3-testnet.creditcoin.network` (`@gluwa/usc-sdk` v0.18.0) | builds Merkle + continuity proof for a source tx |
| On-chain proof verification | **BlockProver precompile `0x0FD2`** via `INativeQueryVerifier.verifyAndEmit` | the only trust root; reverts the whole call if the proof is false |

No part of this flow uses a mocked proof, a fake precompile, or a trusted
relayer assertion.

### Verified infrastructure facts (from Phase 0 spike, re-checked)

| Item | Value | How verified |
|---|---|---|
| CC3 Testnet RPC | `https://rpc.cc3-testnet.creditcoin.network` | direct call returned chainId `102031` (`0x18e8f`) |
| Proof Builder root | `https://prover.cc3-testnet.creditcoin.network` | HTTP health OK; `/api` responds |
| Proof tx endpoint | `GET /api/v1/proof-by-tx/{chainKey}/{txHash}` | read from `@gluwa/usc-sdk@0.18.0` source |
| Attested-height endpoint | `GET /api/v1/attested-height/{chainKey}` | read from `@gluwa/usc-sdk@0.18.0` source |
| Sepolia chainKey (CC3 testnet) | `1` | ChainInfo precompile `getSupportedChains()` |
| BlockProver precompile | `0x0FD2` | CC3 chain config |
| ChainInfo precompile | `0x0FD3` | CC3 chain config |
| usc-sdk / usc-contracts | `0.18.0` / `0.1.2` | installed dependencies |

---

## 2. The functional flow (what VEIL does with Attestcoin, step by step)

VEIL uses Attestcoin to prove two facts per order:

1. **Payment** - an agent paid a provider (`AgentPayment` event).
2. **Fulfillment** - the provider delivered (`FulfillmentReceipt` event).

### 2.1 Step 1 - the source chain emits an event

`VeilSource.sol` (Sepolia) records the payment and the provider, then emits:

```solidity
event AgentPayment(uint256 indexed orderId, address indexed agent,
  address indexed provider, uint256 amount, bytes32 serviceId,
  bytes32 transactionRef);

event FulfillmentReceipt(uint256 indexed orderId, address indexed provider,
  bytes32 resultHash, bytes32 serviceId, bytes32 transactionRef);
```

The contract is intentionally minimal (Attestcoin best practice: source
contracts hold minimal logic and emit events). Since hardening G1, only the
provider recorded at payment time may emit `FulfillmentReceipt`.

### 2.2 Step 2 - the worker watches and waits for attestation

`services/attestation/worker.ts` polls Sepolia with `queryFilter` for both
events. For each transaction it:

1. Resolves the tx from the source chain RPC (`sourceChainRpc.getTransaction`).
2. Refuses to proceed if the tx is not mined.
3. Reads the latest attested height for chainKey `1` via
   `PrecompileChainInfoProvider.getLatestAttestedHeightAndHash(chainKey)`.
4. **Will not build a proof until the containing block is attested**
   (`blockNumber > latestAttested.height` -> error, not a guess).
5. Waits for the Proof Builder to ingest the attestation
   (`ProofBuilder.waitUntilHeightAttested`).

This "wait for attestation" gate is what makes the integration genuine: a proof
cannot be fabricated for a block Creditcoin has not attested.

### 2.3 Step 3 - a real proof is generated

`services/attestation/generateProof.ts` builds the proof via the **official**
`@gluwa/usc-sdk`:

```ts
const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, proofBuilderUrl);
const result = await proofBuilder.getProof(txHash);
```

`result.data` is a `ContinuityResponse` containing `txBytes`, `headerNumber`,
`merkleProof` (root + siblings), and `continuityProof` (lowerEndpointDigest +
roots).

### 2.4 Step 4 - the proof is submitted to the ASC `execute()`

`submitProof()` calls the VEIL **Attestation Receiver** (ASC) on Creditcoin:

```solidity
function execute(
  uint8 action,          // 0 = Payment, 1 = Fulfillment
  uint64 chainKey,       // 1 (Sepolia)
  uint64 blockHeight,    // headerNumber from the proof
  bytes calldata encodedTransaction,  // txBytes from the proof
  bytes32 merkleRoot,
  INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
  bytes32 lowerEndpointDigest,
  bytes32[] calldata continuityRoots
) external returns (bool success);
```

`action 0` maps to `AgentPayment`, `action 1` to `FulfillmentReceipt`.

### 2.5 Step 5 - the precompile verifies (verify == falsify)

Inside `execute()`, `_verifyProof` calls the real precompile:

```solidity
VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction,
  merkleProof, continuityProof);
```

`VERIFIER` is `NativeQueryVerifierLib.getVerifier()`, resolved to precompile
`0x0FD2` at deploy time. **If the proof is invalid, the call reverts** - state
only changes after the native verifier accepts the proof synchronously.

Details of the verification sequence:

1. Compute `queryId` from `(chainKey, blockHeight, txIndex)`; `txIndex` comes
   from the real precompile view `calculateTxIndex(merkleProof)`.
2. Revert if that query was already processed (`processedQueries[queryId]`).
3. Mark `processedQueries[queryId] = true` **before** verification on purpose:
   if `_verifyProof` reverts, the whole call (and the mark) is rolled back, so a
   failed submit can never be blocked by a half-consumed queryId.
4. `verifyAndEmit` returns only if the proof validates.
5. If the proof is false -> revert (verify == falsify).

---

## 3. Decoding and persisting the verified facts

Once the proof passes, the ASC decodes the transaction using the official
`EvmV1Decoder` (from `@gluwa/usc-contracts@0.1.2`):

`_validateTransactionContents` enforces all of these before any state write:

| Check | Revert reason |
|---|---|
| a `veilSource` is registered | `SourceContractNotRegistered` |
| the tx type is a supported EVM tx type | `UnsupportedTransactionType` |
| the receipt status is `1` (SUCCESS) | `TransactionFailed` |
| the expected event signature exists in the logs | (no logs -> no match) |
| the event was emitted by the **registered `veilSource`** address | `SourceContractMismatch` |

Then the facts are persisted:

- `Payment` action -> `paymentsVerified[orderId] = true`,
  `verifiedPaymentAmounts[orderId]`, `verifiedServiceId[orderId]`,
  `verifiedAgent[orderId]`, `verifiedProvider[orderId]`; emits `PaymentVerified`.
- `Fulfillment` action -> `fulfillmentsVerified[orderId] = true`,
  `verifiedResultHash[orderId]`; emits `FulfillmentVerified`.

These mappings are exactly the inputs `SettlementEngine` requires before it will
release an escrow (see `CONTRACTS.md` for the gate list).

---

## 4. Where the verified facts gate settlement

`SettlementEngine.settle(orderId)` reverts unless, among other checks:

- `AttestationReceiver.isPaymentVerified(orderId)` is true and
  `isFulfillmentVerified(orderId)` is true (verified service + verified
  fulfillment).
- the escrow's **payer** equals `verifiedAgentOf(orderId)` and the escrow's
  **provider** equals `verifiedProviderOf(orderId)` (hardening G2 -
  `EscrowPartyMismatch`), so a permissionless `createEscrow` cannot divert a
  settlement to an unattested counterparty.

Net effect: on Creditcoin, money (CTC) only moves after Attestcoin says the
source-chain payment + fulfillment are real.

---

## 5. The demo mirror (explicitly not Attestcoin)

The frontend/console demo does **not** call the precompile. It runs the full
flow in-process with an in-memory `SettlementLedger` that implements the same
state machine and access rules, and the UI labels those states as
**mirror**. The real Attestcoin path (steps in section 2) is fully written -
worker, proof generation, ASC, precompile call, decoder, settlement gates - but
executing it live is blocked in this environment (see `TESTNET.md`, section 6).

What is real vs what is mirrored in the repo:

| Capability | Real in repo | Mirrored in demo |
|---|---|---|
| Proof generation (usc-sdk ProofBuilder) | yes | - |
| ASC `execute` + precompile `0x0FD2` | yes (contract) | ledger flags labeled **mirror** |
| `EvmV1Decoder` decode + source allowlist | yes (contract) | - |
| Worker polling + proof submit | yes (worker) | - |
| Live proof submission to CC3 | - | **blocked** (no funded wallets / keys) |
| Demo purchase UI states | - | yes |

---

## 6. Blocker inventory (honest)

| # | Item | Status |
|---|---|---|
| 1 | `forge` / `cast` installed | **DONE** (Foundry installed, `forge test` runs 19/19) |
| 2 | Deploy `VeilSource` on Sepolia | **DONE** — `0xbe2d0793344e656690be44b81128BbF0EDa6F93c` |
| 3 | Deploy `AttestationReceiver` ASC on CC3 | **DONE** — `0x071ff3210EA7619B7065ea24058030464093Dccd` |
| 4 | Generate a real proof for a real VEIL event | **DONE** — 10/10 events verified on CC3 |
| 5 | End-to-end live run (`npm run worker`) | **DONE** — order 603000 settled live on-chain |
| 6 | Solidity compile (19 contracts, 0.8.23) | **DONE** (`node script/compile-check.js`) |
| 7 | Services typecheck | **DONE** (`npm run typecheck`, exit 0) |
| 8 | Read-only live-check canary | **DONE in Phase 0**; requires nothing secret |

---

## 7. How to take it live

1. Install Foundry (git-bash / MSI) or rely on `script/compile-check.js`.
2. Fill `.env` from `.env.example` (`SOURCE_CHAIN_RPC_URL`,
   `SOURCE_CHAIN_CONTRACT_ADDRESS`, `USC_ATTESTATION_RECEIVER_ADDRESS`,
   `SETTLEMENT_ENGINE_ADDRESS`, `CREDITCOIN_WALLET_PRIVATE_KEY`).
3. `npm run deploy` - deploys `EvmV1Decoder`, `AttestationReceiver`
   (`--libraries`), `VeilSource`, then registers the source in the ASC.
4. Fund the Sepolia wallet; agents/UI call `VeilSource.recordAgentPayment`
   then `recordFulfillment`.
5. `npm run worker` - watches Sepolia, waits for attestation, generates real
   proofs, submits them to the ASC.
6. Watch `PaymentVerified` / `FulfillmentVerified` on CC3; `SettlementEngine`
   can then settle.
7. Sanity: `npm run live-check`, `npm run typecheck`,
   `node script/compile-check.js`.

See `TESTNET.md` for the full reproduction walkthrough.
