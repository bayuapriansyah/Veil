# VEIL - Architecture

This document describes the VEIL system architecture as built: the components,
how data flows through a purchase, the API surface, and the boundaries between
**real**, **mirrored**, and **not-yet-executed** behavior.

Companion docs: `CONTRACTS.md`, `ATTESTCOIN.md`, `AGENT.md`, `PRIVACY_MODEL.md`.

---

## 1. Overview

VEIL is organized into four groups:

- **Chains**
  - Source chain (Ethereum Sepolia): `VeilSource.sol` emits `AgentPayment` /
    `FulfillmentReceipt` events.
  - Settlement chain (Creditcoin CC3): `AttestationReceiver` (ASC) +
    `SettlementEngine` + `MandateManager` + `EscrowManager` +
    `ReputationEngine` + `VeilRegistry`; precompile `0x0FD2` verifies proofs.
- **Services** (Node.js / TypeScript, this repo)
  - `services/attestation` - worker, proof generation, live-check.
  - `services/provider` - x402 HTTP rail, payment verification, ledger mirror.
  - `services/procurement` - ProcurementAgent (7 tools), ProcurementShop, planner.
  - `services/audit` - AuditVault, EIP-712 AuditAccess, HTTP server.
  - `services/demo` - end-to-end simulation + flow tests.
- **Frontend** (Next.js 14 app router)
  - `/` marketing landing.
  - `/app` operations console (dashboard, agents, mandates, transactions,
    audit, providers, canvas).

### The honest boundary (real vs mirror)

| Layer | Real in the repo | Mirrored in the demo | Not executed here |
|---|---|---|---|
| x402 HTTP handshake + EIP-3009 crypto | yes (`services/provider/x402.ts`) | - | - |
| EIP-712 VeilPayment (veil-exact) + ECRECOVER | yes (`adapter.ts`) | - | - |
| AgentPayment / FulfillmentReceipt events | `VeilSource.sol` written | ledger flags | live on Sepolia |
| Attestcoin proof generation + ASC verification | worker + ASC written | ledger flags labeled **mirror** | live proof + submit |
| Escrow / settlement / refund state machine | contracts written | `SettlementLedger` (memory) | on-chain settlement |
| x402 on-chain USDC settlement | - | - | not claimed (needs live USDC + facilitator) |

---

## 2. Component responsibilities

### 2.1 Smart contracts (`contracts/src/`)

- `VeilSource.sol` - source-chain (Sepolia). Minimal by design: holds
  `orderPaidBy` / `orderProvider`, emits `AgentPayment` and `FulfillmentReceipt`.
  Fulfillment only from the provider recorded at payment (hardening G1).
- `AttestationReceiver.sol` - the ASC on Creditcoin. `execute(...)` verifies a
  proof via precompile `0x0FD2`, decodes with `EvmV1Decoder`, requires the
  emitting contract equals the registered `veilSource`, persists verified facts.
- `SettlementEngine.sol` - only the `settlementOperator` may settle/refund.
  `settle(...)` enforces escrow Locked, verified service/payment/fulfillment,
  mandate validity, amount match, escrow parties == ASC-verified identities (G2).
- `MandateManager.sol` - mandate state machine (owner, agentId, budget, spent,
  allowedService, expiration, Active/Revoked).
- `EscrowManager.sol` - escrow state machine (`None -> Locked -> Released |
  Refunded`), holds CTC value.
- `ReputationEngine.sol` - settlement success/failure/refund/violation counters.
- `VeilRegistry.sol` - agent registry (owner, status, reputationRef).
- Supporting: `OwnableLite.sol`, `ReentrancyGuardLite.sol`.

Per-contract detail: `CONTRACTS.md`.

### 2.2 Services

- `services/attestation/` - `worker.ts` polls Sepolia, waits for attestation,
  generates proofs via `ProofBuilder` (`@gluwa/usc-sdk`), submits `execute()`
  to the ASC. `generateProof.ts` refuses to build a proof before the block is
  attested. `live-check.ts` is a read-only canary. `config.ts` holds endpoints.
- `services/provider/` - `server.ts` exposes the x402 rail and order/payment
  endpoints. `adapter.ts` is the `veil-exact` demo adapter (EIP-712
  `VeilPayment`, ECRECOVER, deterministic result hash). `x402.ts` is the real
  `exact`/EIP-3009 crypto. `ledger.ts` is the in-memory `SettlementLedger`.
- `services/procurement/` - `shop.ts` wires N providers (+HTTP servers) into one
  catalog. `agent.ts` is the `ProcurementAgent` (7 tools, planner with optional
  LLM soft-fail). `plan.ts` is the deterministic 9-step planner. `tools.ts` holds
  the tool implementations and the safety gate.
- `services/audit/` - `vault.ts` is the disclosure authority (AES-256-GCM at
  rest, auditor registry, nonces). `signer.ts` builds/verifies EIP-712
  `AuditAccess`. `crypto.ts` is the key hierarchy + seal/open. `server.ts`
  exposes public + signed + operator endpoints.
- `services/demo/` - `sim.ts` runs the full flow in-process; `agent.ts` is the
  `VeilAgent` HTTP client.

### 2.3 Frontend (`frontend/`)

- Server-side singleton: `lib/veil-runtime.ts` builds the real in-process stack
  (`ProcurementShop` + `ProcurementAgent` + audit vault), anchored on
  `globalThis` so every `/api/veil/*` route drives the **same** rail. All GET
  API routes are `force-dynamic`.
- Pages: `/` landing; `/app` dashboard; `/app/agents`, `/app/agents/[id]`;
  `/app/mandates`; `/app/transactions` + `[id]`; `/app/audit`; `/app/providers`;
  `/app/canvas`.
- Client: browser-safe `lib/veil-client.ts` (no node/service imports),
  `lib/use-poll.ts` polling (1.5-4s).

---

## 3. The purchase flow (end to end)

### 3.1 Demo path (frontend console)

1. User clicks "Run purchase" in the agent cockpit.
2. `POST /api/veil/purchase {task}` -> `getRuntime().purchase(task)` ->
   `ProcurementAgent.run(task)`:
   - `plan` (deterministic or LLM soft-fail),
   - `searchProviders` -> `getProviderDetails` -> `checkReputation` ->
     `checkMandate` -> `checkBudget` -> `requestService` -> `checkBudget` ->
     `makePayment`.
3. `makePayment`: `POST /api/payments` (records AgentPayment), then
   `GET /api/market-data` with `X-PAYMENT` (EIP-712 VeilPayment signed by agent).
4. Provider ECRECOVERs signer, matches recorded AgentPayment, fulfills, records
   result hash + FulfillmentReceipt.
5. Operator settle: `provider.settle(orderId, OPERATOR)` -> escrow Released,
   mandate spent incremented.
6. `vault.recordTransaction(...)` (sensitive fields sealed AES-256-GCM via the
   audit rail).
7. Response `{ ok, orderId }` back to the UI; pages poll
   `state/orders/audit`.

### 3.2 Live/on-chain path (written, blocked in this environment)

1. `VeilSource.recordAgentPayment` / `recordFulfillment` (Sepolia).
2. Worker polls events, waits for block attestation (Creditcoin).
3. `ProofBuilder.getProof(txHash)` (real proof).
4. `AttestationReceiver.execute(action, chainKey, blockHeight, txBytes,
   merkleRoot, siblings, lowerEndpointDigest, continuityRoots)`.
5. `queryId` via precompile `calculateTxIndex`.
6. `VERIFIER.verifyAndEmit(...)` (precompile `0x0FD2`).
7. `EvmV1Decoder` decode + source allowlist check.
8. Persist verified facts, emit `PaymentVerified` / `FulfillmentVerified`.
9. `SettlementEngine.settle(orderId)` (operator-only, multiple gates).

The demo `SettlementLedger` implements the same state machine and access rules,
so the two paths are behaviorally equivalent where it matters for testing.

---

## 4. API surface

### 4.1 Frontend `/api/veil/*`

| Route | Verb | Purpose |
|---|---|---|
| `/api/veil/state` | GET | agent status, kill switch, budget/spend, reputation, key source |
| `/api/veil/orders` | GET | order list with per-stage states |
| `/api/veil/purchase` | POST | run one agent purchase end-to-end |
| `/api/veil/kill` | POST | revoke every mandate + refuse future purchases (admin-gated) |
| `/api/veil/providers` | GET | provider catalog (reputation, eligibility, services) |
| `/api/veil/audit` | GET | public register (never decrypts) + auditor registry |
| `/api/veil/audit/authorize` / `revoke` | POST | vault auditor registry controls (admin-gated) |
| `/api/veil/audit/disclose` | POST | signed EIP-712 AuditAccess, ECRECOVER, nonce, selective fields |
| `/api/veil/audit/attempt` | POST | deliberately unauthorized auditor (proves the gate) |

### 4.2 Provider service (Node HTTP)

| Route | Verb | Purpose |
|---|---|---|
| `/api/market-data` | GET | 402 + PAYMENT-REQUIRED -> paid -> 200 + PAYMENT-RESPONSE |
| `/api/payments` | POST | record an AgentPayment (ledger mirror) |
| `/api/orders/:id` | GET | escrow/payment/fulfillment/service/provider/payer + supplement |
| `/api/settle/:id` | POST | operator-only escrow release |
| `/api/refund/:id` | POST | refund when fulfillment missing |
| `/api/providers` | GET | profile + catalog + reputation + scheme |
| `/api/mandates` | GET | active mandates |
| `/scheme` | GET | brands veil-exact as a vendor adapter scheme |
| `/health` | GET | liveness |

### 4.3 Audit service (Node HTTP)

| Route | Verb | Purpose |
|---|---|---|
| `/api/audit/txs`, `/api/audit/tx/:txId` | GET | public view (never decrypts) |
| `/api/audit/disclosure/:txId?fields=...` | GET | signed + authorized selective disclosure |
| `/api/audit/evidence/:txId` | GET | signed + authorized evidence bundle |
| `/api/audit/vault` | POST | operator records a transaction (sealed) |
| `/api/audit/authorize` / `revoke` | POST | operator auditor registry |
| `/api/audit/health` | GET | key source + tx count |

---

## 5. State machines

### 5.1 Mandate (`MandateManager` / `SettlementLedger`)

- `Active -> Revoked` (owner revoke).
- `Active -> expired` (expiry); revoked/expired mandates cannot spend.
- Remaining budget = budget - spent; never goes negative.

### 5.2 Escrow (`EscrowManager` / `SettlementLedger`)

- `None -> Locked` (create with value).
- `Locked -> Released` (settlement engine, verified facts).
- `Locked -> Refunded` (payer or engine when fulfillment missing).

### 5.3 Purchase timeline (6 stages in the UI)

```
Authorization -> Payment -> Payment Attestation -> Fulfillment
  -> Fulfillment Attestation -> Settlement
```

Each stage maps to a `RuntimeOrder.stages[]` entry colored by the real ledger
state. Refused/revoked orders flash red and stop at the failing stage; a
not-yet-attested gap never glows.

---

## 6. The frontend runtime (`veil-runtime.ts`)

`getRuntime()` constructs and reuses a single `VeilRuntime` on `globalThis`:

- `ProcurementShop` with three providers (reputations 5, 5, 2 - the 2 is
  excluded by discovery, demonstrating the reputation gate).
- A user mandate registered on **every** provider ledger (each ledger is the
  authority for its own purchases).
- `AuditVault` with the key resolved by `loadVaultKey()` (env / file /
  ephemeral), surfaced as `keySource` in the UI.
- The runtime-owned demo auditor authorized **once** at startup with scope
  `all`; disclosure enforces nonce replay + authorization at the vault.
- `kill()` sets the kill switch and revokes every active mandate on every ledger.

All state the browser sees crosses the `/api/veil/*` JSON API. The browser never
imports the node service modules (webpack-safe separation).

---

## 7. Reliability / deployment notes

- Every GET route is `force-dynamic` so pages reflect live state rather than a
  build-time snapshot.
- `getRuntime()` is why the console is one coherent rail: Next bundles each
  route handler separately, so a bare module singleton would be instantiated per
  route.
- The demo is in-memory and localhost-only. For production, the same service
  layer would talk to deployed contracts via RPC (see `DEPLOYMENT.md`) and the
  vault would use a durable KMS-backed key (see `PRIVACY_MODEL.md`, roadmap).
