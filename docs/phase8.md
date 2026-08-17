# VEIL — Phase 8: The Agent Economy Console (UI)

The web frontend that operates the whole VEIL stack as an **infrastructure
product** — not a generic crypto dashboard. It renders real state from the
Phase 3-7 service layer: the demo SettlementLedger, the x402/veil-exact
purchase path, the ProcurementAgent plan, and the Phase 7 sealed audit vault.

```
Browser (Next.js pages)                Next route handlers                VEIL services (node)
 ├─ Dashboard ─┐                       ┌─────────────────┐                ┌──────────────────────┐
 ├─ Agent      ├─ fetch /api/veil/* ──►├─ getRuntime()   │                │ services/provider/*  │
 ├─ Mandate    │   (2.5s polling)      │  (globalThis    │  drive the R →│  ledger · server ·    │
 ├─ Tx list/id │                       │   = live rail)  │  REAL stack    │  adapter (x402)       │
 ├─ Audit      │                       └─────────────────┘                ├──────────────────────┤
 ├─ Providers  │                       POST purchase/kill/audit           │ services/procurement  │
 └─ Canvas ────┘                                                           │  shop · agent · plan  │
                                                                          ├──────────────────────┤
                      canvas animates REAL stage state                    │ services/audit/*      │
                  (never fakes a blockchain event)                       │  vault · signer  …    │
                                                                          └──────────────────────┘
```

## 1. Stack

- **Next.js 14** (app router) + **TypeScript** + **Tailwind** (dark infra
  palette in `frontend/tailwind.config.ts`).
- Canvas rendering is raw **HTML Canvas 2D** (no chart lib) — one
  `requestAnimationFrame` loop in `components/economy-canvas.tsx`.
- The browser never imports the node service modules. All state crosses the
  `/api/veil/*` JSON API so webpack stays clean and each page stays live by
  polling (`lib/use-poll.ts`, 1.5-4s depending on page).

## 2. Server-side runtime (`frontend/lib/veil-runtime.ts`)

The one place that actually *does things*, in-process against the real
`services/` modules:

- builds a `ProcurementShop` (3 providers; the low-reputation one is excluded
  by discovery), registers the user mandate on every provider ledger,
- a `ProcurementAgent` (deterministic planner unless `OPENAI_API_KEY` is real),
- an `AuditVault` with the key loaded by `loadVaultKey()` (env/file/ephemeral —
  surfaced to the UI as `keySource`).
- **`getRuntime()` anchors the runtime on `globalThis`.** Next bundles each
  route handler separately, so a bare module singleton would be instantiated
  once per route and the pages would see different state; anchoring on
  `globalThis` means every `/api/veil/*` route drives the *same* rail.

A purchase (`POST /api/veil/purchase`) runs the real path:
`agent.run(task)` → `requestService` → `makePayment` (real HTTP handshake) →
operator `provider.settle` (mirrors SettlementEngine: escrow `Locked → Released`,
and **spending increments only here**) → `vault.recordTransaction` (sealed).

## 3. Route map (`app/api/veil/*`)

| route | verb | does |
|---|---|---|
| `state` | GET | agent status, kill switch, mandate, budget/spend, reputation, vault key source |
| `orders` | GET | order list incl. per-stage states |
| `purchase` | POST | run one agent purchase end-to-end |
| `kill` | POST | revoke every mandate + refuse future purchases |
| `providers` | GET | provider catalog (reputation, eligibility, services) |
| `audit` | GET | public register (txId, commitment, status banners — never decrypts) + auditor registry |
| `audit/authorize` · `revoke` | POST | vault auditor registry controls |
| `audit/disclose` | POST | signs a real EIP-712 `AuditAccess`, ECRECOVER-verifies, consumes nonce, vault discloses **only requested fields** |
| `audit/attempt` | POST | a deliberately unauthorized auditor, to prove the gate refuses it |

All GET routes are `force-dynamic` — otherwise Next would statically prerender
them at build time and serve frozen snapshots.

## 4. Pages

1. **Dashboard** — agent status, mandate spend gauge, verified tx count,
   provider reputation, recent orders, live rails overview.
2. **Agent** (cockpit) — purchase console (with prompt), the exact 7-tool
   surface shown as UI, identity, kill switch.
3. **Mandate** — budget/spent/remaining (as atoms + USD display), enforcement
   model, kill switch.
4. **Transactions** — order table (`orderId · service · provider · amount ·
   settlement · when`), links to detail.
5. **Transaction detail** — full 6-stage timeline, each stage colored by the
   REAL ledger state, refusal errors surfaced, result hash + vault link.
6. **Audit** — public register, auditor registry (authorize/revoke),
   selective-disclosure console (fields picker, full bundle), and the
   unauthorized-attempt proof.
7. **Providers** — catalog with eligibility chips (`★ reputation ≥ 3`).
8. **Agent Economy Canvas** — the flagship visualization.

## 5. The Canvas and the honesty rule

Path: `USER → AI AGENT → PROVIDER → PAYMENT → SOURCE CHAIN → ATTESTCOIN →
CREDITCOIN → SETTLEMENT`. Each order's packet:

- traverses **only the stages whose stage-state the rail has actually
  reached** (`authorization/payment/payment-attestation/fulfillment/
  fulfillment-attestation/settlement` → node indices), then parks,
- flashes red and stops if the order was refused/revoked,
- the attestation stage is the **SettlementLedger mirror** of the real
  AttestationReceiver state; the page's disclaimer states that no live ASC
  submission is performed or claimed. A PENDING gap never glows.

## 6. Verified (smoke test against the production build)

```
POST /api/veil/purchase          → { ok:true, orderId:"1189" }
GET  /api/veil/orders            → order 1189, escrowStatus Released
GET  /api/veil/audit             → txCount 1, tx veil-1189 (sealed)
POST /api/veil/audit/disclose    → exactly the requested fields decrypted
POST /api/veil/audit/attempt     → refused: "authorization revoked or never granted"
POST /api/veil/kill              → agent status killed, mandate revoked
POST /api/veil/purchase (after)  → refused: "kill switch engaged"
```

`npx tsc --noEmit` clean · `npx next build` clean (one benign warning from the
agent's dynamic `openai` import) · 20 routes generated.

## 7. Run

```bash
cd frontend
npm install        # done
npm run build      # done
npm start          # production server on :3000
```

Open http://localhost:3000 — the console talks only to the in-process demo
stack, so it works with zero deployed contracts or funded wallets.

## 8. Honest framing (carries through every phase)

- Money displays derive USD from atom strings via `BigInt` math — no BigInt-in-JSON.
- No fake blockchain event is ever drawn or claimed; attested mirrors are labeled.
- Attestcoin verifies cross-chain facts; VEIL controls disclosure — the audit
  page repeats this boundary in its own words.