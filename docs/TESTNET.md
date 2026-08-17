# VEIL - Testnet Guide

This document is the reproduction walkthrough for the **live** VEIL +
Attestcoin loop on public testnets (Ethereum Sepolia as source chain, Creditcoin
CC3 Testnet as settlement chain). It also records exactly what was and was not
executed in this environment.

Companion docs: `ATTESTCOIN.md` (the protocol flow), `DEPLOYMENT.md`
(deployment script), `DEVELOPMENT.md` (local verification).

---

## 1. The testnets VEIL uses

| Chain | Role | Details |
|---|---|---|
| Ethereum Sepolia | source chain | `VeilSource.sol`; chainId `11155111`; CC3-internal chainKey `1` |
| Creditcoin CC3 Testnet | settlement chain | ASC + engine; chainId `102031`; RPC `https://rpc.cc3-testnet.creditcoin.network` |

Verified facts (Phase 0 spike, still current):

| Item | Value |
|---|---|
| CC3 Testnet RPC | `https://rpc.cc3-testnet.creditcoin.network` (chainId `102031`) |
| Proof Builder | `https://prover.cc3-testnet.creditcoin.network` (live, health OK) |
| Proof endpoint | `GET /api/v1/proof-by-tx/{chainKey}/{txHash}` |
| Attested-height endpoint | `GET /api/v1/attested-height/{chainKey}` |
| Sepolia chainKey | `1` |
| BlockProver precompile | `0x0000000000000000000000000000000000000FD2` |
| ChainInfo precompile | `0x0000000000000000000000000000000000000FD3` |

---

## 2. Step-by-step live run

### 2.1 Prereqs (machine with Foundry + funded wallets)

- `forge` + `cast` installed.
- CTC wallet funded on CC3 Testnet (Discord faucet) - pays ASC submission.
- Sepolia wallet funded with Sepolia ETH - pays `VeilSource` calls.

### 2.2 Deploy

```bash
npm run deploy
```

Deploys `EvmV1Decoder` (CC3), `AttestationReceiver` (CC3, library-linked),
`VeilSource` (Sepolia), then registers the source on the ASC. Prints the three
addresses for `.env`.

### 2.3 Record a payment + fulfillment on the source chain

With `VeilSource` deployed and `.env` set, call from the frontend rail or
directly:

```solidity
veilSource.recordAgentPayment(orderId, provider, amount, serviceId, txRef);
// provider's wallet:
veilSource.recordFulfillment(orderId, resultHash, serviceId, txRef);
```

Each call mines a Sepolia transaction that emits the event Attestcoin will prove.

### 2.4 Run the worker (proof generation + ASC submission)

```bash
npm run worker
```

Behavior (all real, per `services/attestation/`):

1. Polls `VeilSource` for `AgentPayment` / `FulfillmentReceipt` events.
2. For each tx: resolves it, **waits until its block is attested** on CC3
   (`getLatestAttestedHeightAndHash` + `ProofBuilder.waitUntilHeightAttested`),
   then fetches a real proof via `ProofBuilder.getProof(txHash)`.
3. Submits `execute(action, ...)` to the ASC with gas estimation (with a
   deterministic fallback for the pallet-evm precompile).
4. On success the ASC emits `PaymentVerified` (action 0) or
   `FulfillmentVerified` (action 1).

### 2.5 Settle

Once both facts are verified, the settlement operator calls
`SettlementEngine.settle(orderId)`. It passes the gate list in `CONTRACTS.md`
section 4 (verified payment + fulfillment, mandate valid, amount match, escrow
parties == ASC-verified identities) and releases the CTC escrow.

---

## 3. Read-only canary (no private key)

`npm run live-check` validates the exact infrastructure VEIL depends on:

1. CC3 chain id (expect `102031`).
2. ChainInfo precompile supported chains.
3. ChainInfo latest attested height.
4. BlockProver precompile reachability (`computeTransactionIndex` view call to
   `0x0FD2`).

This is safe to run anywhere with network access.

---

## 4. Environment checklist

```
SOURCE_CHAIN_KEY=1
PROOF_BUILDER_URL=https://prover.cc3-testnet.creditcoin.network
SOURCE_CHAIN_ID=11155111
SOURCE_CHAIN_RPC_URL=<sepolia rpc w/ key>
CREDITCOIN_RPC_URL=https://rpc.cc3-testnet.creditcoin.network
SOURCE_CHAIN_CONTRACT_ADDRESS=<after deploy>
USC_ATTESTATION_RECEIVER_ADDRESS=<after deploy>
SETTLEMENT_ENGINE_ADDRESS=<after deploy>
CREDITCOIN_WALLET_PRIVATE_KEY=<funded CTC>
USC_DECODER_LIBRARY_ADDRESS=<after deploy, optional>
```

---

## 5. What was verified in this environment

| Check | Status |
|---|---|
| CC3 RPC reachable, chainId `102031` | **DONE** (Phase 0 direct RPC call) |
| Proof Builder live (308 -> /api, health OK) | **DONE** (Phase 0) |
| Sepolia chainKey `1`, Mainnet `3` | **DONE** (ChainInfo precompile) |
| Attested height queryable | **DONE** (Phase 0 spike) |
| BlockProver precompile address | **DONE** (CC3 chain config) |
| 19 contracts compile (0.8.23) | **DONE** (`node script/compile-check.js`) |
| services typecheck | **DONE** (`npm run typecheck`, exit 0) |
| 26 tests / 4 suites | **DONE** (offline, in-process) |
| `forge` / `cast` available | **BLOCKED** (not installed; foundryup needs bash) |
| Deploy `VeilSource` on Sepolia | **BLOCKED** (needs funded Sepolia wallet + RPC key) |
| Deploy ASC + decoder on CC3 | **BLOCKED** (needs funded CTC wallet) |
| Real proof for a real VEIL event | **BLOCKED** (needs a mined source event first) |
| Live `npm run worker` end-to-end | **BLOCKED** (needs the above) |

---

## 6. Getting unblocked (for judges / maintainers)

1. Install Foundry (git-bash or MSI) or set `SOLC_BIN` and rely on
   `compile-check.js`.
2. Fund a CC3 Testnet wallet via the Creditcoin Discord faucet; fund a Sepolia
   wallet via a public faucet.
3. Fill `.env` from `.env.example`.
4. `npm run deploy` -> `npm run worker` -> settle via the console/operator.
5. Sanity anytime: `npm run live-check`.

---

## 7. Honesty note

The demo console runs the **same state machine** against an in-memory mirror and
labels those states **mirror** - it does not fabricate live attestations. The
live loop above is the real path; it is written, compiles, and is ready, but was
not executed here because the required tooling/wallets are absent.
