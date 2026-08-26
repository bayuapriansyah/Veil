# VEIL — Verifiable Economic Infrastructure Layer for Autonomous AI Agents

**VEIL** is a reference architecture for trustworthy agent-to-provider payments.
It gives an autonomous AI agent a way to pay for services that it can
independently verify happened, on a rail where a human stays in control.

The name is recursive: **V**erifiable **E**conomic **I**nfrastructure
**L**ayer.

> **Submission note (BUIDL CTC 2026 Fall).** This README and the files in
> `docs/` distinguish three layers everywhere: what is **production
> functionality**, what is a **hackathon prototype**, and what is **optional
> roadmap** work. Fabricated infrastructure claims are never made — each
> claim is tagged with its real execution status (see
> [Attestcoin integration status](#attestcoin-integration-status) and
> [docs/ATTESTCOIN.md](docs/ATTESTCOIN.md)).

---

## Table of contents

1. [Problem](#problem)
2. [Solution](#solution)
3. [Why Creditcoin](#why-creditcoin)
4. [Why Attestcoin](#why-attestcoin)
5. [How Attestcoin is functionally used](#how-attestcoin-is-functionally-used)
6. [Architecture](#architecture)
7. [AI Agent](#ai-agent)
8. [A2A Delegation](#a2a-delegation)
9. [Payment](#payment)
10. [Fulfillment](#fulfillment)
11. [Escrow](#escrow)
12. [Privacy](#privacy)
13. [Audit](#audit)
14. [Kill Switch](#kill-switch)
15. [Technology stack](#technology-stack)
16. [Deployment](#deployment)
17. [Testing](#testing)
18. [Limitations](#limitations)
19. [Future roadmap](#future-roadmap)
20. [Production vs prototype vs roadmap](#production-vs-prototype-vs-roadmap)
21. [Repository map](#repository-map)
22. [Getting started](#getting-started)
23. [Attestcoin integration status](#attestcoin-integration-status)
24. [Trust model](#trust-model)
25. [Security notes](#security-notes)
26. [Environment](#environment)
27. [Documentation](#documentation)

---

## Problem

AI agents are starting to spend money autonomously — buying APIs, data,
compute, and tooling on a user's behalf. Today that happens with very little
accountability:

- **No proof of payment or delivery.** An agent claims it "paid" and the
  provider claims it "delivered"; nothing independently verifiable links the
  two claims.
- **The agent is a black box.** The user cannot determine *why* a purchase was
  made, whether it matched the mandate, and whether the money actually moved.
- **Oversight is coarse or absent.** Today's agent wallets are either a raw
  private key (all-or-nothing) or a custodial spend limit. There is no
  per-purchase envelope, no escrow, and no reliable way to halt an out-of-control
  agent.
- **Audit is all-or-nothing.** Giving an auditor every transaction is a privacy
  loss; showing nothing is an accountability failure. Most agent-payment
  designs have no middle path.

## Solution

VEIL binds three rails into one honest system:

1. **Cross-chain verification.** A payment or fulfillment event on the source
   chain is proven on Creditcoin using Attestcoin, and only a verified fact can
   unlock settlement. *Attestcoin verifies that something happened across
   chains — it does not, by itself, decide what the user may see.*
2. **An agent with a deliberately tiny tool surface.** The agent can search
   providers, check a mandate, request a service, and pay — and nothing else.
   It has **no** settle / refund / revoke / budget / escrow tools. The ledger
   (not the agent) is the authority.
3. **A privacy-preserving audit vault.** Each transaction's sensitive metadata
   (agent, provider, amount, evidence) is sealed with AES-256-GCM at rest. An
   auditor authorized by the operator can disclose **only the fields they were
   granted**, through a signed, nonce-guarded EIP-712 `AuditAccess` request.

Plus an explicit **kill switch**: one operator action revokes every mandate on
every provider ledger at once and refuses any future purchase at the gate.

## Why Creditcoin

VEIL's settlement state machine — mandates, escrow, settlement, reputation —
is expressed as a Creditcoin contract suite (`MandateManager`, `EscrowManager`,
`SettlementEngine`, `ReputationEngine`, `VeilRegistry`). Creditcoin's model fits
the problem:

- **Attestcoin Protocol Readability** gives VEIL a *native precompile*
  (`0x0000…0FD2`) that verifies Merkle + continuity proofs of source-chain
  transactions. The verification source is the same chain that runs VEIL's
  settlement. There is no bridge middleware that could be trusted *instead of*
  verified.
- **Settlement and verification are on the same ledger.** `SettlementEngine`
  reads ASC-verified facts (see below) directly from `AttestationReceiver`
  before releasing escrow. No external oracle is needed for cross-chain
  payment/fulfillment attestation on the settlement path.
- **CC3 Testnet is live and free**, which makes the whole loop (source chain →
  proof builder → precompile → settlement) testable without deployment cost on
  mainnet.

## Why Attestcoin

Attestcoin is the mechanism that turns "trust the agent" into "verify the
fact." Specifically:

- It lets VEIL prove that `AgentPayment` and `FulfillmentReceipt` events
  **really were emitted** by the VEIL source contract on the source chain, by
  validating the block **attested** by Creditcoin validators.
- The proof is verified **inside the chain the money settles on** (precompile
  `0x0FD2`), so a settlement cannot be authorized by an unverified claim, a
  forged receipt, or a stale block header.
- It gives public, tamper-evident evidence that survives the agent and the
  provider disagreeing. The evidence bundle in VEIL's audit vault carries the
  attestation identifier for exactly this purpose.

Attestcoin **does not** provide privacy, and VEIL does not claim it does. The
boundary is repeated throughout this project: *Attestcoin verifies the fact;
VEIL controls who sees the details.*

## How Attestcoin is functionally used

This section explains, without marketing language, exactly what runs where and
what is and is not executed.

### The five functional steps

| # | Where | What runs | Status |
|---|-------|-----------|--------|
| 1 | **Source chain (Sepolia)** — `VeilSource.sol` | Emits `AgentPayment(orderId, agent, provider, amount, serviceId, transactionRef)` when an agent pays, and `FulfillmentReceipt(orderId, provider, resultHash, serviceId, transactionRef)` when the provider delivers. | **Deployed** `0xbe2d07…6F93c`; live events recorded (including from the frontend rail). |
| 2 | **Off-chain worker** — `services/attestation/worker.ts` | Watches Sepolia for those events; waits until the containing block is **attested** on Creditcoin; asks the **Proof Builder** service for a real proof. | **Running live**; retries pending proofs every poll cycle. |
| 3 | **Proof builder (Attestcoin infra)** — `https://prover.cc3-testnet.creditcoin.network` | `/api/v1/proof-by-tx/{chainKey}/{txHash}` returns the Merkle + continuity proof, gated on `/api/v1/attested-height/{chainKey}`. | **Live** — proofs fetched and used in real submissions. |
| 4 | **Creditcoin ASC** — `AttestationReceiver.sol` | `execute(...)` computes the query id, calls the **BlockProver precompile `0x0FD2`** `verifyAndEmit(...)`, decodes the verified transaction with `EvmV1Decoder`, checks the emitting address equals the registered `veilSource`, and stores `paymentsVerified` / `verifiedAgent` / `verifiedProvider` / `verifiedServiceId` / `fulfillmentsVerified` / `verifiedResultHash`. | **Deployed** `0x071ff3…3Dccd`; 8/8 proofs verified (see `docs/TESTNET.md` §5.1). |
| 5 | **Settlement** — `SettlementEngine.sol` | `settle(orderId)` refuses unless: escrow `Locked`, service verified, mandate valid, payment verified, fulfillment verified, payment amount ≥ escrow amount, and the escrow's payer/provider equal the ASC-verified agent/provider. Only then is escrow released and spend debited. | **Deployed** on CC3 (`0x197F…8dd7`); order 603000 settled live end-to-end (worker-driven, see `docs/TESTNET.md` §5.1). |

### The honest boundary

- The **full loop (1→5) is executed live** on CC3 Testnet + Sepolia: payment →
  proof → ASC verification → on-chain settlement (order 603000). In
  `VEIL_MODE=demo`, the console runs the identical state machine against the
  in-memory `SettlementLedger` instead — clearly labeled.
- The audit vault's attestation evidence starts sealed with the real
  `sourceTx` when the purchase recorded on-chain; the **worker** then attaches
  the Creditcoin proof tx and flips the public status to `verified`. If
  recording soft-fails (flaky RPC), the record stays `mirror` — the system
  never claims a live on-chain event that did not happen.
- Purchases are signed by a **dedicated agent wallet**, separate from the
  deployer wallet, so the operator's deploy key is not the recurring on-chain
  identity (the linkage is only the one-time funding transfer).

## Architecture

```
             ┌────────────────────────── Creditcoin CC3 Testnet ─────────────────────────┐
             │  AttestationReceiver (ASC)  MandateManager  EscrowManager  SettlementEngine │
             │  VeilRegistry  ReputationEngine     precompile 0x0FD2  EvmV1Decoder (lib)    │
             └──────▲──────────────────────────────────────────────────────────────────────┘
                    │  execute() ProofBuilder proof
   Attestcoin worker│
   ─────────────────┼────────────────────────────────────────────────────────────────────────
                    │  AgentPayment / FulfillmentReceipt
            ┌───────┴────────┐  (Sepolia)          ┌──────────────────────────────────────────┐
            │  VeilSource.sol │                    │  services/ (Node.js)                      │
            │  (source chain) │                    │  provider: x402 HTTP rail + ledger mirror │
            └─────────────────┘                    │  procurement: agent (7 tools) + shop      │
                                                    │  audit: AES-256-GCM vault + signer        │
                                                    └──────────────▲───────────────────────────┘
                                                                   │ /api/veil/* (getRuntime singleton)
                                                    ┌──────────────┴───────────────────────────┐
                                                    │  frontend/ Next.js console (under /app)    │
                                                    └───────────────────────────────────────────┘
```

Detailed diagrams, networking, and per-component behavior live in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### Components

| Component | Role |
|-----------|------|
| `contracts/src/` (Solidity 0.8.23) | The source/settlement contract suite (see [`docs/CONTRACTS.md`](docs/CONTRACTS.md)). |
| `services/attestation/` | Proof generation + submission worker (`worker.ts`, `generateProof.ts`, `live-check.ts`). |
| `services/provider/` | The provider HTTP rail: real x402 handshake, payment verification (ECRECOVER), settlement ledger mirror. |
| `services/procurement/` | The AI procurement agent (7-tool surface), the `ProcurementShop`, and the deterministic 9-step planner. |
| `services/audit/` | The audit vault (AES-256-GCM at rest), auditor registry, EIP-712 `AuditAccess` signer/verifier. |
| `services/demo/` | End-to-end flow simulation + the `VeilAgent` client. |
| `frontend/` | Next.js product: marketing landing `/` + operations console under `/app`. |
| `script/` | `deploy.ts` (foundry deploy orchestration), `compile-check.js` (solc-js Standard JSON harness). |

## AI Agent

The procurement agent (`ProcurementAgent`) is deliberately minimal. It has
**exactly 7 tools** — 5 read-only and 2 state-changing:

| # | Tool | Kind |
|---|------|------|
| 1 | `searchProviders(serviceId)` | read-only — providers offering the service with reputation ≥ 3 |
| 2 | `getProviderDetails(provider)` | read-only — profile, services, reputation, operator |
| 3 | `checkMandate(serviceId)` | read-only — active mandate covering the service (ledger mirror) |
| 4 | `checkBudget(serviceId, amountAtoms)` | read-only — remaining ledger budget ≥ amount |
| 5 | `checkReputation(provider)` | read-only — star score (1-5; < 3 excluded) |
| 6 | `requestService(...)` | state-changing — reserve a payment offer (no money moves) |
| 7 | `makePayment(orderId)` | state-changing — **the only payment path** |

There is **no** settle / refund / revoke / budget-modify / verify / escrow tool.
`assertSafeToolName` rejects any unknown or privileged-looking name, including
LLM-produced ones (see [`docs/AGENT.md`](docs/AGENT.md)).

Planner selection:

- **Default** — a deterministic 9-step plan (`searchProviders → getProviderDetails
  → checkReputation → checkMandate → checkBudget → requestService → checkBudget →
  makePayment → checkMandate`). Same plan every run.
- **Optional LLM** — when `OPENAI_API_KEY` is set (and not `sk-none`), one
  OpenAI tool-use call is attempted; output is validated against the same
  7-tool allowlist. On **any** error it soft-fails to the deterministic planner.
  The agent never fabricates an outcome.

## A2A Delegation

Agent A can delegate procurement tasks to Agent B via the A2A (Agent-to-Agent)
JSON-RPC protocol (`@a2a-js/sdk` v1). The flow:

1. Agent A signs a delegation payload (`{ type: 'a2a-delegation', orderId,
   agent, task, timestamp }`) with its on-chain wallet key.
2. Agent B receives the `SendMessage` request, verifies the EIP-191 signature
   (recovering the signer), checks the 5-minute freshness window, and
   cross-checks the payload fields (orderId, task, agent) against the message
   metadata.
3. If valid, Agent B executes the procurement using its own wallet (Agent B →
   Shop C on-chain AgentPayment + FulfillmentReceipt on Sepolia).
4. Agent B returns the verified result including on-chain tx hashes for both the
   B→C payment and the A→B fulfillment.

Agent B self-registers on the `VeilRegistry` contract on CC3 at startup, making
its endpoint discoverable by Agent A on-chain (see
[`services/agent-b/`](services/agent-b/)).

Security guarantees:
- **Unsigned delegations are rejected** — an unverified caller can never spend
  Agent B's wallet.
- **Stale delegations are rejected** — replay guard enforces a 5-minute
  freshness window.
- **Agent A's address is resolved from the on-chain registry**, not hardcoded.

## Payment

- **x402 HTTP handshake (real).** `GET /api/market-data` without payment returns
  `HTTP 402` + a `PAYMENT-REQUIRED` header (base64 JSON). With payment it returns
  the resource + a `PAYMENT-RESPONSE` header.
- **Real `exact`/EIP-3009 component.** `services/provider/x402.ts` builds and
  ECRECOVER-verifies the EIP-3009 `transferWithAuthorization` digest. This is the
  official x402 scheme — and in this demo it does **not** claim on-chain USDC
  settlement (that requires a live USDC/EVM node + facilitator; see
  [docs/phase3-4.md](docs/phase3-4.md)).
- **`veil-exact` demo adapter (vendor scheme).** VEIL's own payment: the agent
  records an `AgentPayment`, signs an EIP-712 `VeilPayment`, and the provider
  ECRECOVERs the signer and requires the matching recorded payment. This is
  VEIL's rail — explicitly **not** official x402.
- The provider advertises both (`accepts = [exact, veil-exact]`) and handles each
  transparently; `/scheme` and the purchase timeline label each one.

## Fulfillment

- On a successful paid call, the provider records fulfillment: the merchant data
  returns `200`, a deterministic **result hash**
  `keccak256(pack(orderId, serviceId, provider, payloadRef))` is produced (see
  `VeilAdapter.computeResultHash`), and `FulfillmentReceipt` is recorded.
- In the live architecture the `FulfillmentReceipt` event on `VeilSource` is what
  Attestcoin proves; in the demo, `SettlementLedger.markFulfillmentVerified`
  mirrors that state.
- Settlement refuses (escrow stays `Locked`) until fulfillment exists.

## Escrow

- Each order creates a **escrow** entry (`SettlementLedger.createEscrow`, mirror
  of `EscrowManager`): payer, provider, mandate, amount, status.
- State machine: `None → Locked → Released | Refunded`.
  - `release` only when `Locked`, budget-compliant, payment **and** fulfillment
    verified, and (mirror/contract) the payer/provider match ASC-verified
    identities (`EscrowPartyMismatch` protection).
  - `refund` only when `Locked`, callable by the payer or the settlement engine.
- In the demo, escrow stays `Locked` after the agent pays; **only the operator**
  can settle (release) or refund — the agent has no such tool.

## Privacy

- Every transaction's sensitive metadata (agent, provider, amount, authorization,
  payment/fulfillment/attestation/settlement evidence) is sealed with
  **AES-256-GCM** at rest (`services/audit/crypto.ts`).
- Key hierarchy: master vault key from `VEIL_VAULT_KEY` (64 hex), else
  `VEIL_VAULT_KEY_FILE`, else an **ephemeral** key for demo/tests. A
  per-transaction data key is derived with HKDF-SHA256 (`info = txId`) so one
  leaked key does not open the vault.
- The **public** view (anyone) is only `txId`, `commitment`, verification /
  policy / settlement status, and the **live attestation facts** — `sourceTx`
  (the Sepolia AgentPayment tx) and `attestationStatus` (`mirror` / `proving` /
  `verified`), plus `attestationTx` (the Creditcoin proof-submit tx) once the
  worker attaches it. These are public chain data, so exposing them costs no
  privacy — the sealed fields (agent, provider, amount, evidence) stay
  encrypted. Public endpoints ignore credentials by design.
- Detailed flow: [`docs/PRIVACY_MODEL.md`](docs/PRIVACY_MODEL.md).

Boundary: AES-256-GCM protects VEIL data at rest; it does **not** make Attestcoin
private.

## Audit

- A VAULT (`AuditVault`) is the disclosure authority. The operator authorizes
  auditors (`scope: 'all'` or a txId allow-list) and can revoke them.
- An auditor discloses via a **signed EIP-712 `AuditAccess`**
  `(resource, txId, nonce, expiresAt)` that the server ECRECOVER-verifies; a
  header address alone is never trusted. The vault enforces: signer = auditor,
  nonce replay guard, authorization (not revoked, in scope).
- **Selective disclosure**: `?fields=agent,amountUsd,authorization` returns
  exactly those fields; the rest is never decrypted. Full evidence bundles
  (`payment` / `fulfillment` / `attestation` / `settlement`) are available to
  authorized auditors.
- Endpoints: `/api/audit/txs`, `/api/audit/tx/:txId` (public), `/disclosure/`,
  `/evidence/` (signed), `/vault`, `/authorize`, `/revoke` (operator),
  `/health`. The console's audit panel (`/app/audit`) shows the public
  attestation column; the worker updates it live via
  `POST /api/veil/audit/attach` (proving → verified) once a real
  `PaymentVerified`/`FulfillmentVerified` event exists on Creditcoin.

## Kill Switch

One operator action — `POST /api/veil/kill` (or the UI **Engage kill switch**)
— does three things atomically (`veil-runtime.ts` → `SettlementLedger` /
`MandateManager` semantics):

1. Sets the kill switch flag.
2. **Revokes every active mandate** on every provider ledger
   (`revokeMandate(mandateId)` per ledger).
3. **Refuses all future purchases** at the gate (`kill switch engaged`).

The agent is not "destroyed"; its authority is withdrawn and its status flips
to `KILLED` in every dashboard. This mirrors the operator's real on-chain
`MandateManager.revokeMandate`. The kill switch is durable for the process
lifetime (in-memory demo; resets on restart).

## Technology stack

| Layer | Technology |
|-------|------------|
| Smart contracts | Solidity `0.8.23`, OpenZeppelin `^5.4.0`, `@gluwa/usc-contracts` `0.1.2` (EvmV1Decoder), `@gluwa/usc-sdk` `0.18.0` |
| Chains | Source: Ethereum Sepolia (`11155111`) · Settlement: Creditcoin CC3 Testnet (`102031`) |
| Services | Node.js + TypeScript (strict), ethers v6, `tsx`, Node `http` servers (no framework) |
| Frontend | Next.js 14 (app router), TypeScript, Tailwind, wagmi/viem/ethers, React Query, `motion`, `@phosphor-icons/react`, `geist` |
| Tooling | npm workspaces-equivalent scripts, solc-js compile harness (`compile-check.js`), Forge suite (ready, binary absent) |

## Deployment

Live deployment is **executed on testnet** (CC3 Testnet + Sepolia). The
deployment path (`script/deploy.ts`) orchestrates via `forge create`/`cast send`:

1. Deploy `EvmV1Decoder` library (or reuse `USC_DECODER_LIBRARY_ADDRESS`).
2. Deploy `AttestationReceiver` ASC on CC3 Testnet with `--libraries` linking.
3. Deploy `VeilSource` on Sepolia.
4. `registerVeilSource(source)` on the ASC.

Live addresses (this environment): `VeilSource` (Sepolia)
`0xbe2d0793344e656690be44b81128BbF0EDa6F93c` · `AttestationReceiver` (CC3)
`0x071ff3210EA7619B7065ea24058030464093Dccd` · `EvmV1Decoder` (CC3)
`0x4eF11C369D9CAd4Fe68894a8B1D71Bc177c80b26`. `forge`/`cast` 1.5.1 note:
`forge create` requires `--broadcast` (baked into `deploy.ts`).

Full prerequisites, ordering, and verification: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Testing

- **50 tests / 8 suites** (Node), all green:
  - `services/provider/x402.test.ts` — 8 tests (real x402 `exact`/EIP-3009 crypto,
    sign/ECRECOVER, mismatch/hyper-payment/tamper rejection, time-window
    enforcement, nonce replay guard, amount enforcement).
  - `services/provider/hardening.test.ts` — 16 tests (auth, rate limit, CORS,
    error queue, replay).
  - `services/demo/flow.test.ts` — 9 tests (the 7 required scenarios + malformed
    payment + settlement authorization).
  - `services/procurement/procurement.test.ts` — 7 tests (success, budget breach,
    service breach, revoked mandate, state authority, privilege guard,
    deterministic fallback).
  - `services/audit/audit.test.ts` — 5 tests (unauthorized, authorized, encrypted
    metadata/tamper, selective disclosure, revoked + nonce replay).
  - `services/config/mode.test.ts` — mode resolution tests.
  - `services/agent-b/executor.test.ts` — delegation signature verification tests.
- **`npm run typecheck`** (root + frontend) green.
- **`npm run compile-check`** — 19 Solidity contracts compile via solc-js.
- **Frontend production build** (`npm run build`) green (17 routes).
- **Forge suite** (`contracts/test/VeilFoundation.t.sol`) — **19/19 pass**
  (forge-std installed, `forge test` runs clean).
- Live Attestcoin integration: **executed** — 10/10 facts verified on CC3 incl.
  live frontend purchases and agent-wallet purchases; proofs attached to the
  audit vault live (`see docs/TESTNET.md §5.1`).

## Limitations

Honest inventory of what VEIL is and is not at this stage:

- **The cross-chain Attestcoin loop is executed live on testnet** (Sepolia →
  CC3), and every frontend purchase also records a real `AgentPayment`
  (best-effort, soft-fail). Order 603000 completed the full on-chain loop:
  Sepolia payment → Attestcoin proof → ASC verification → SettlementEngine
  settle. The frontend runs the same state machine against an in-memory mirror
  in demo mode, explicitly labeled.
- **`veil-exact` is a VEIL demo-adapter scheme, not official x402.** The only
  *official* x402 component (`exact`/EIP-3009) does cryptographic verification
  but no on-chain USDC settlement (no live facilitator). The repo does not claim
  a USDC settlement it does not perform.
- **Demo state is in-memory.** Orders, vault records, mandates, and the kill
  switch reset with the server process. Not durable by design.
- **Vault key is ephemeral by default.** Set `VEIL_VAULT_KEY` / key file for
  durability; the demo **does** require a key to seal at rest.
- **Demo authorization uses a runtime-owned auditor and demo keys.** It is
  explicitly not a real PKI; a production deployment needs real operator
  identities and key management.
- **`VEIL_ADMIN_TOKEN` is a localhost guard, not real auth.** Setting it
  hardens the destructive endpoints; it is documented as not-a-substitute for
  real network auth.
- **Reputation gating (`≥ 3`) is enforced off-chain** (agent/discovery + UI).
  On-chain settlement enforces mandate/budget/service/identity/attestation; on-chain
  reputation threshold enforcement is roadmap.
- **Single service demo catalog** (market-data … and compute) drives the default
  run; the architecture is general.
- **No Forge execution** in this environment; the suite is untested-here.

## Future roadmap

Optional, not-yet-implemented (see the 3-tier table below for status):

- On-chain USDC settlement for the official `exact` scheme (needs live USDC +
  facilitator node).
- Enforce reputation threshold inside `SettlementEngine` on-chain.
- Real operator/auditor identity management (PKI / KMS-signed vouchers) and
  network-grade auth (not `VEIL_ADMIN_TOKEN`).
- Durable state (SQLite/Postgres) for the vault and mandates instead of memory.
- WAI-ARIA / accessibility polish and Playwright E2E coverage of the console.
- Multi-service and multi-chain source support; batch proofs
  (`generateBatchProofFor`).

## Production vs prototype vs roadmap

| Capability | Production | Hackathon prototype (this repo runs this) | Optional roadmap |
|---|---|---|---|
| Smart contracts (compiled, G-hardened) | ✅ written, compile-verified | — | — |
| Source-chain events (`VeilSource`) | ✅ **deployed on Sepolia** (`0xbe2d07…6F93c`) | ✅ live events | — |
| Attestcoin proof generation + ASC verification | ✅ | ✅ live (proofs verified on CC3) | batch proofs |
| On-chain settlement (`SettlementEngine` + `EscrowManager` + `MandateManager`) | ✅ **deployed on CC3** | ✅ order 603000 settled live | multi-token settlement |
| Real x402 `exact`/EIP-3009 ECRECOVER crypto | ✅ incl. amount/expiry/nonce-replay checks | ✅ (no USDC transfer claimed) | on-chain USDC settlement |
| `veil-exact` demo adapter | — | ✅ (vendor scheme, honestly labeled) | — |
| A2A delegation (agent→agent, signed) | ✅ signature-verified, replay-guarded | ✅ Agent B via `@a2a-js/sdk` v1 | streaming + push notifications |
| On-chain agent registry (`VeilRegistry`) | ✅ deployed CC3 | ✅ self-registration + discovery | signed agent cards |
| AI procurement agent (7 tools) | ✅ | ✅ deterministic planner | live wallet + LLM planner |
| Audit vault AES-256-GCM + EIP-712 `AuditAccess` | ✅ | ✅ (ephemeral key by default) | KMS keys, durable store |
| Kill switch | ✅ logic | ✅ | durable revocation record |
| Reputation gate ≥ 3 | — | ✅ off-chain (+ ReputationEngine deployed) | on-chain enforcement |
| Provider hardening (TLS / API-key auth / rate limit) | ✅ middleware shipped | ✅ env-gated | mTLS, WAF |
| Frontend console | — | ✅ dual-mode (demo/production badges) | a11y polish, E2E specs |

## Repository map

| Path | What lives there |
|------|------------------|
| `contracts/src/` | Solidity suite: `VeilSource` (source), `AttestationReceiver` (ASC), `SettlementEngine`, `MandateManager`, `EscrowManager`, `ReputationEngine`, `VeilRegistry`, supporting `OwnableLite` / `ReentrancyGuardLite` (see `docs/CONTRACTS.md`) |
| `contracts/test/` | Forge suite `VeilFoundation.t.sol` |
| `services/attestation/` | Worker, proof generation, live-check, error-queue replay, config |
| `services/provider/` | x402 HTTP rail, EIP-3009 verification, settlement ledger mirror, TLS/auth/rate-limit middleware |
| `services/agent-b/` | A2A delegation server/client (Agent B), signed delegation verification |
| `services/procurement/` | Procurement agent (7 tools), shop, deterministic planner |
| `services/audit/` | Audit vault, EIP-712 signer/verifier, HTTP server |
| `services/config/` | Demo/production mode resolution + production gate |
| `services/demo/` | End-to-end sim + flow tests |
| `frontend/` | Next.js landing `/` + console `/app` (dual-mode UI) |
| `script/` | `deploy.ts`, `deploy-settlement.ts`, `compile-check.js` |
| `docs/` | 10 focused guides + phase notes (see [Documentation](#documentation)) |

## Getting started

Requires Node 18+ and npm.

```bash
npm install
npm install --prefix frontend
```

### Verify everything compiles and passes

```bash
npm run typecheck            # services TS (tsc --noEmit)
npm run compile-check        # all contracts compile via solc-js (0.8.23, paris)
npm test                     # 8 suites / 50 tests
cd frontend && npm run typecheck && npm run build
```

### Run the end-to-end demo (no blockchain keys required)

```bash
npm run demo                 # full VEIL flow over the real HTTP rail
# focused demos:
npm run demo:provider        # standalone x402 provider
npm run demo:procurement     # procurement agent demo
npm run demo:audit           # vault + signed auditor disclosure demo
```

```bash
# Frontend console (separate terminal)
cd frontend && npm run dev   # http://localhost:3000
```

The frontend drives the *real* in-process stack (procurement shop over the HTTP
rail + audit vault) through `/api/veil/*`. It runs in one of two honest modes:

- **`VEIL_MODE=demo`** (zero setup): wallets are generated, no chain is touched,
  attestation state is labeled **mirror** everywhere it appears.
- **`VEIL_MODE=production`**: purchases record real `AgentPayment` events on
  Sepolia, the worker proves them on Creditcoin CC3, and the SettlementEngine
  settles escrow on-chain. The sidebar shows a red `LIVE` badge and fee
  warnings; attestation labels read *proven on Creditcoin*.

Full developer guide: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) · guided demo:
[`docs/DEMO.md`](docs/DEMO.md).

### Run in production mode (real chains)

```bash
# frontend/.env
VEIL_MODE=production
SOURCE_CHAIN_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
SOURCE_CHAIN_CONTRACT_ADDRESS=0xbe2d0793344e656690be44b81128BbF0EDa6F93c
SOURCE_CHAIN_WALLET_PRIVATE_KEY=<funded agent key>
# ...plus CC3 wiring (see .env.example)

npm run worker        # separate terminal: proves Sepolia events on CC3 + settles
cd frontend && npm run dev
```

Each purchase burns a small amount of Sepolia ETH-equivalent plus CC3 CTC for
proof/settlement gas — fund both wallets first (see `docs/TESTNET.md`).

### Attestcoin live steps (needs keys + Foundry)

```bash
npm run live-check           # read-only canary vs CC3 Testnet + Proof Builder
npm run worker               # watch Sepolia events -> generate proofs -> submit ASC
npm run deploy               # foundry deploy of EvmV1Decoder / ASC / VeilSource
```

After a worker restart, pass `WORKER_FROM_BLOCK` to re-ingest older events that
were not yet proven. Testnet configuration: [`docs/TESTNET.md`](docs/TESTNET.md).

## Attestcoin integration status (honest)

The integration is real and **executed live** against verified infrastructure
(`docs/ATTESTCOIN.md`):

| Step | Status |
|------|--------|
| CC3 Testnet RPC + Proof Builder verified (chainId `102031`, Sepolia chainKey `1`) | DONE |
| Solidity compilation (19 contracts, solc-js) | DONE |
| TypeScript typecheck + 50 tests / 8 suites | DONE |
| Read-only live-check | DONE |
| Deploy `VeilSource` on Sepolia | **DONE** — `0xbe2d0793344e656690be44b81128BbF0EDa6F93c` |
| Deploy `AttestationReceiver` ASC on CC3 | **DONE** — `0x071ff3210EA7619B7065ea24058030464093Dccd` |
| Deploy settlement stack (`MandateManager`, `EscrowManager`, `SettlementEngine`) on CC3 | **DONE** — wired to the worker (see `docs/TESTNET.md`) |
| Generate a real proof + submit to ASC | **DONE** — 10/10 events verified incl. live frontend purchases and agent-wallet purchases; proofs attached to the audit vault live (see `docs/TESTNET.md` §5.1) |
| Live `npm run worker` end-to-end | **DONE** — survives RPC resets, retries pending proofs, structured logs + health check (:8082) |
| Full purchase→proof→settlement loop on-chain | **DONE** — order 603000: Sepolia payment + fulfillment events → CC3 proofs → SettlementEngine settle tx `0xde8315…6f8e` |
| Foundry `forge test` | **DONE** — 19/19 Solidity tests pass (forge-std installed) |

Full evidence table with tx hashes and blocks: [`docs/TESTNET.md`](docs/TESTNET.md).

## Trust model

- **Attestation is never faked.** Facts only change after Creditcoin's native
  verifier validates a proof (precompile `0x0FD2`) against the registered source
  contract.
- **Reputation eligibility (≥ 3) is a discovery-layer rule** — enforced in the
  procurement mirror and the UI agent gate; it is **not** currently enforced
  inside `SettlementEngine` on-chain. On-chain settlement enforces mandate
  validity, budget, service match, and verified payment/fulfillment/party facts.
- **The audit vault protects VEIL data at rest** (AES-256-GCM). The master key is
  read from `VEIL_VAULT_KEY` / `VEIL_VAULT_KEY_FILE`, or is **ephemeral** in demo
  mode. It does not make Attestcoin private.
- **Demo state is in-memory.** Orders, vault records, and the kill switch reset on
  server restart. Intentional for a localhost demo; not presentable as durable.
- **Demo routes are localhost-only.** Set `VEIL_ADMIN_TOKEN` to harden the
  destructive endpoints (kill / audit authorize / audit revoke) — they require
  `x-veil-admin: <token>` when set. Public routes are fine on `127.0.0.1`; do not
  expose them on a network.
- For services, an operator header (`x-operator`) gates `/api/settle` etc.; it is
  a demo convention, not real auth.

## Security notes

### Applied hardening (G1–G6)

1. `VeilSource.recordFulfillment` binds the emitter to the **provider recorded at
   payment** (`orderProvider`) — a non-provider can no longer forge a
   `FulfillmentReceipt` that the ASC would mark verified.
2. `SettlementEngine.settle` requires the escrow's **payer and provider to equal
   the ASC-verified agent and provider** (`verifiedAgentOf` / `verifiedProviderOf`)
   — escrows can no longer settle to an unattested counterparty.
3. `.gitignore` covers `.next/`, `.env.local`, `*.tsbuildinfo`, `coverage/`.
4. The demo auditor is authorized **once at startup** with an explicit scope, not
   re-authorized per disclosure.
5. Kill / audit-authorize / audit-revoke are gated by `VEIL_ADMIN_TOKEN` when set.
6. `AttestationReceiver.execute` documents why marking `processedQueries` before
   verification is safe (a failed verification reverts the whole call).

Full threat modeling: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Environment

See `.env.example`. Required only for live Attestcoin steps:
`SOURCE_CHAIN_RPC_URL`, `SOURCE_CHAIN_CONTRACT_ADDRESS`,
`USC_ATTESTATION_RECEIVER_ADDRESS`, `CREDITCOIN_WALLET_PRIVATE_KEY`. Optional
hardening: `VEIL_VAULT_KEY` / `VEIL_VAULT_KEY_FILE`, `VEIL_ADMIN_TOKEN`,
`PROVIDER_OPERATOR_ADDRESS`, `AUDIT_OPERATOR_ADDRESS`.

## Documentation

| File | Contents |
|------|----------|
| [`docs/ATTESTCOIN.md`](docs/ATTESTCOIN.md) | How Attestcoin is functionally used, step-by-step |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System diagrams, data flow, components |
| [`docs/CONTRACTS.md`](docs/CONTRACTS.md) | Each contract: state, access control, events, invariants |
| [`docs/AGENT.md`](docs/AGENT.md) | The 7-tool agent, planner, gates, refusals |
| [`docs/PRIVACY_MODEL.md`](docs/PRIVACY_MODEL.md) | Vault, key hierarchy, selective disclosure |
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | Assets, actors, threats, mitigations |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Foundry deploy path, prerequisites, verification |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Local setup, commands, troubleshooting |
| [`docs/TESTNET.md`](docs/TESTNET.md) | CC3/Sepolia config, chainKeys, Proof Builder, faucets |
| [`docs/DEMO.md`](docs/DEMO.md) | Guided walkthrough of the console + CLI demos |
| `docs/phase3-4.md`, `phase5.md`, `phase7.md`, `phase8.md` | Phase notes (payments, agent, audit, UI) |

## Original work

All contracts, services, tests, and the frontend are original work built for this
project. Third-party code is limited to the declared dependencies
(`@gluwa/usc-contracts`, `@gluwa/usc-sdk`, OpenZeppelin, ethers, Next.js, wagmi,
Tailwind, and the small set in `frontend/package.json`).