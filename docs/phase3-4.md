# VEIL — Phase 3 & 4: Agentic Payment + Fulfillment Flow

This document describes the demo provider + agent flow built in Phase 3/4 and
the honest split between the **real x402 component** and the **VEIL demo
adapter**.

---

## 1. Where this fits

Architecture flow (all implemented, see `services/demo/sim.ts`):

```
AI Agent
  ├─ Provider discovery                        HEAD / GET /api/market-data (unpaid)
  ├─ Provider API                             -> HTTP 402 + PAYMENT-REQUIRED header
  ├─ x402-compatible payment
  │    ├─ REAL x402 component  (exact / EIP-3009)  -> ECRECOVER-verified EIP-712 payload
  │    └─ Demo adapter        (veil-exact)         -> EIP-712 "VeilPayment" + AgentPayment
  ├─ AgentPayment event                        (recorded on the VEIL rail)
  ├─ Attestcoin verification                   (mirrored in the SettlementLedger)
  ├─ Provider fulfills                         (market data / result hash)
  ├─ FulfillmentReceipt event
  ├─ Attestcoin verification
  └─ Creditcoin settlement                    (escrow release or refund)
```

Everything runs against the in-memory **`SettlementLedger`**, which is an exact
mirror of the verified Creditcoin contracts (`EscrowManager`, `SettlementEngine`,
`MandateManager`) state machines. No live chain, no fabricated proof.

---

## 2. IMPORTANT: honest separation of x402 vs the demo adapter

The official x402 fast-path cannot be fully completed on this testnet stack:
there is no live USDC/EVM node, no Coinbase facilitator credentials, and no
deployed token contract in this repo to settle against. Per the project rule
("never fake x402, never claim a normal payment is x402 when it is not"), the
implementation is strictly split:

### 2.1 Real x402 component — `services/provider/x402.ts` (+ `x402.test.ts`)

- Implements the **`exact` scheme on EVM (EIP-3009)** per the verified
  coinbase/x402 specification (`specs/schemes/exact/scheme_exact_evm.md`).
- Client-side: builds the EIP-3009 `transferWithAuthorization` EIP-712 digest
  from the token's real domain (name/version/chainId/verifyingContract) and
  signs it with the wallet.
- Server-side: **verifies the signature by ECRECOVER**, checks payTo/amount.
- Crucially, it does **not claim on-chain settlement**. Completing settlement
  requires a live USDC token + x402 facilitator, which this demo does not have.
  The tests prove the protocol cryptography is correct, offline.

### 2.2 Demo adapter — `services/provider/adapter.ts` (scheme `veil-exact`)

- A **VENDOR scheme**, explicitly NOT the official `exact` scheme.
- The agent records an `AgentPayment` (mirror of `VeilSource.recordAgentPayment`)
  and signs a **VEIL-specific EIP-712 `VeilPayment`** typed message.
- The provider ECRECOVERs the `VeilPayment` signer and requires a matching,
  recorded `AgentPayment` before serving the resource. This is VEIL's rail,
  not x402's USDC transfer.
- /scheme endpoint and logs make the distinction explicit.

The provider advertises **both** schemes (`accepts = [exact, veil-exact]`) and
handles each transparently. This satisfies "real x402 component" + "demo
adapter" with no misrepresentation.

---

## 3. Demo provider — real HTTP endpoints

`services/provider/server.ts` (Node `http`, no framework):

| Endpoint | Behavior |
|----------|----------|
| `GET /api/market-data` | **Unpaid** -> `402` + `PAYMENT-REQUIRED` header (base64 JSON `PaymentRequired`). **Paid** -> `200` + market data + `PAYMENT-RESPONSE` header. |
| `POST /api/payments` | Records an `AgentPayment` (mirror of `VeilSource.recordAgentPayment`) |
| `GET /api/orders/:orderId` | Order status: escrow status, payment/fulfillment verified, serviceId, provider, payer |
| `POST /api/settle/:orderId` | Operator settlement -> escrow release (mirrors `SettlementEngine.settle`) |
| `POST /api/refund/:orderId` | Refund when fulfillment missing (mirrors `SettlementEngine.refund`) |
| `GET /scheme` | Explicit statement that `veil-exact` is a VEIL demo-adapter scheme |
| `GET /health` | Liveness |

Run it standalone:

```
npm run demo:provider          # listens on PROVIDER_PORT (default 8080)
curl -iv http://localhost:8080/api/market-data    # -> 402 + PAYMENT-REQUIRED
```

---

## 4. Agent client (agentic flow)

`services/demo/agent.ts` — `VeilAgent` performs the full agent flow:

1. `discover()` — request, expect 402, decode `PAYMENT-REQUIRED`.
2. `recordAgentPayment()` — POST the AgentPayment on the VEIL rail.
3. `retryWithPayment()` — sign `VeilPayment` (EIP-712) and retry with
   `X-PAYMENT` header -> `200` + data (+ `PAYMENT-RESPONSE`).
4. `orderStatus() / settle() / refund()` — observe and settle/refund.

`services/demo/sim.ts` runs the whole thing in-process and prints a transcript
(`npm run demo`).

---

## 5. Deterministic fulfillment result hash

`VeilAdapter.computeResultHash` (in `adapter.ts`):

```
keccak256(pack(uint256 orderId, bytes32 serviceId, address provider, bytes32 payloadRef))
```

Deterministic for identical inputs (asserted in test 4). Mirrors what the real
flow hashes as fulfillment evidence.

---

## 6. Tests — 7 required scenarios + real x402 protocol tests

`npm test` runs two suites (14 tests total, all offline):

`services/demo/flow.test.ts` — the seven required scenarios:

| # | Scenario | Assertion |
|---|----------|-----------|
| 1 | Unpaid request | HTTP 402 + `PAYMENT-REQUIRED` header |
| 2 | Successful payment | HTTP 200 + market data + fulfillment recorded |
| 3 | Invalid payment | Rejected (no data served) |
| 3b | Malformed X-PAYMENT | 400/402 |
| 4 | Fulfillment | FulfillmentReceipt recorded; deterministic result hash |
| 5 | Missing fulfillment | Settlement blocked (escrow stays Locked) |
| 6 | Escrow release | operator settle -> Released |
| 6b | Settlement authorization | non-operator rejected |
| 7 | Refund | escrow Refunded |

`services/provider/x402.test.ts` — real x402 `exact`/EIP-3009 protocol:

- Spec-conformant `PaymentRequirement`
- Sign + ECRECOVER verification round-trip
- payTo mismatch rejection
- below-minimum amount rejection
- tampered signature (recovery mismatch) rejection

Static checks: `npm run typecheck` (tsc strict) and
`node script/compile-check.js` (Solidity, 19 contracts) both pass green.

---

## 7. What is real vs mirrored (audit trail)

| Piece | Real | Mirrored (not live) |
|-------|------|---------------------|
| x402 HTTP handshake (402, PAYMENT-REQUIRED, X-PAYMENT, PAYMENT-RESPONSE) | yes | — |
| `exact`/EIP-3009 EIP-712 digest + signature + ECRECOVER | yes | — |
| EIP-712 `VeilPayment` signing + verification | yes | — |
| AgentPayment / FulfillmentReceipt events | source contract exists (`VeilSource.sol`) | demo mode uses ledger flags |
| On-chain proof + Attestcoin verification | worker + ASC exist (Phase 2) | not executed (no funded wallet/contracts) |
| Escrow / settlement / refund state machine | contracts exist | ledger mirrors them |
| x402 on-chain settlement (USDC transfer) | no | not claimed |

## 8. Blocked items (unchanged from Phase 2)

- `forge`/`cast` still unavailable -> Solidity tests (`VeilFoundation.t.sol`)
  cannot run in this environment; TS mirror covers the same semantics.
- Live end-to-end (worker, ASC submit, real proofs) still requires deployed
  contracts + funded CTC/Sepolia wallets.