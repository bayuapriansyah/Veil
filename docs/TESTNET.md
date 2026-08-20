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
SOURCE_CHAIN_WALLET_PRIVATE_KEY=<funded Sepolia wallet used to record payments from the frontend rail>
SOURCE_CHAIN_POLL_RPC_URL=<optional; dedicated RPC for the worker's eth_getLogs polling — some free RPCs throttle getLogs>
WORKER_FROM_BLOCK=<optional; re-scan the source chain from an old block on restart>
WORKER_AUDIT_ATTACH_URL=http://127.0.0.1:3000/api/veil/audit/attach (optional; the worker POSTs the verified proof tx here so the audit panel flips proving -> verified)
```

---

## 5. What was verified in this environment

| Check | Status |
|---|---|
| CC3 RPC reachable, chainId `102031` | **DONE** (Phase 0 direct RPC call) |
| Proof Builder live (308 -> /api, health OK) | **DONE** (Phase 0) |
| Sepolia chainKey `1`, Mainnet `3` | **DONE** (ChainInfo precompile) |
| Attested height queryable | **DONE** (Phase 0 spike; current lag ~44 blocks) |
| BlockProver precompile address | **DONE** (CC3 chain config) |
| 19 contracts compile (0.8.23) | **DONE** (`node script/compile-check.js`) |
| services typecheck | **DONE** (`npm run typecheck`, exit 0) |
| 26 tests / 4 suites | **DONE** (offline, in-process) |
| `forge` / `cast` available | **DONE** (`forge`/`cast` 1.5.1 at `C:\foundry\bin`) |
| Deploy `VeilSource` on Sepolia | **DONE** — `0xbe2d0793344e656690be44b81128BbF0EDa6F93c` |
| Deploy ASC + decoder on CC3 | **DONE** — ASC `0x071ff3210EA7619B7065ea24058030464093Dccd`, decoder `0x4eF11C369D9CAd4Fe68894a8B1D71Bc177c80b26`; `veilSource()` on ASC == Sepolia address |
| Real proof for a real VEIL event | **DONE** — see evidence table below |
| Live `npm run worker` end-to-end | **DONE** — see evidence table below |
| Live on-chain record from the frontend rail | **DONE** — `PurchaseConsole` → `makePayment` → `VeilSource.recordAgentPayment` (soft-fail, `services/attestation/record.ts`) |

### 5.1 Live on-chain evidence (this environment, CC3 Testnet)

Source events mined on **Sepolia** (`VeilSource` `0xbe2d07…6F93c`), proven and
submitted to the **AttestationReceiver** ASC on **CC3** (`0x071ff3…3Dccd`):

| # | Action | Sepolia source tx (block) | CC3 proof/submit tx | CC3 block | AttestationReceiver event |
|---|---|---|---|---|---|
| 1 | payment order 1 (amount 1000) | `0xe57888d3…e689d1` (11529279) | `0x81bdc5c7…ba7bb19c` | 5343036 | `PaymentVerified` |
| 2 | payment order 2 (amount 2000) | `0x773c0ba3…d7848de6` (11529320) | `0x4458acf4…d8696021` | 5343037 | `PaymentVerified` |
| 3 | fulfillment order 1 | `0x1011fb03…bafc715bf` (11529281) | `0x5e112774…cb701cf40` | 5343039 | `FulfillmentVerified` |
| 4 | fulfillment order 2 | `0x8b2e4d08…750c3e2d` (11529323) | `0x76d5a443…4082e2a2` | 5343040 | `FulfillmentVerified` |
| 5 | payment order 1189 (live frontend purchase) | `0x569b6bf4…32f8cc4d75` (11529560) | `0x569e77b7…d2fd2f6` | 5343204 | `PaymentVerified` |
| 6 | payment order 1190 (live frontend purchase) | `0xf8c9d6b5…fd01c20` (11529562) | `0x1f9ebf31…9c82756` | 5343211 | `PaymentVerified` |
| 7 | payment order 400000 (agent-wallet purchase) | `0x7cda07f3…1db243ad43` (11529996) | `0x31559ca2…550c290bb` | 5343570 | `PaymentVerified` |
| 8 | payment order 500000 (agent-wallet purchase, live audit) | `0xcbd5c56a…1aed9019c` (11530179) | `0xd65f59c5…642640720` | 5343728 | `PaymentVerified` |

`PaymentVerified` topics decode to `(orderId, agent, provider, amount, serviceId,
queryId)`; `FulfillmentVerified` to `(orderId, provider, resultHash, queryId)`.
Agent and provider for all demo orders = `0x5264075C4a12BD3CdC356f587EcDa010BdcCF34A`
and `0x2222…2222` (demo provider) respectively; **since the address-hygiene
split, purchases are signed by the dedicated agent wallet
`0x34252d307816948D440856Bb98245bE0EA60aAF2`** (rows 7-8). Attestation lag on
CC3 for chainKey 1 measured at ~44 Sepolia blocks; the worker waits for
attestation (configurable timeout, default 15 min) and retries failed proofs
every poll cycle. Row 8 was proven and **attached live to the audit vault** via
`POST /api/veil/audit/attach`, flipping `veil-500000` from `proving` to
`verified` in the console.

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

The demo console runs the same state machine against an in-memory mirror and
labels those states **mirror** where no live on-chain event is claimed. Since
Phase 8 wiring, every purchase made from the frontend `PurchaseConsole` ALSO
records a real `AgentPayment` on Sepolia (best-effort, soft-fail), which the
worker proves and submits to Creditcoin. The audit vault records the live facts
in its **public** columns — `sourceTx` (the Sepolia AgentPayment) and
`attestationStatus` (`mirror` / `proving` / `verified`) — and, once the worker
submits the proof, the `attestationTx` (the Creditcoin proof-submit tx) via
`POST /api/veil/audit/attach`. The system never fabricates a live attestation:
a record stays `proving` (or `mirror` when nothing was recorded on-chain) until
a real `PaymentVerified`/`FulfillmentVerified` event exists on Creditcoin.

Since the 3-layer split, purchases are signed by a **dedicated agent wallet**
(separate from the deployer wallet) so the operator's deployer key is never the
recurring on-chain identity; the linkage between them is only the one-time
funding transfer.
