# VEIL - Demo Guide

This is the operator's guide to the VEIL console (`http://localhost:3000`):
what it does, the honest "mirror" labeling, and the step-by-step E2E walkthrough.

Companion docs: `ARCHITECTURE.md` (system view), `AGENT.md` (agent behavior),
`PRIVACY_MODEL.md` (audit), `TESTNET.md` (the real on-chain loop).

---

## 1. What the demo is

The console runs the **real VEIL stack in-process** (Next.js server side):

- a `ProcurementShop` with **3 providers** (reputations **5, 5, 2** - the `2`
  is excluded by discovery, demonstrating the reputation gate),
- a `ProcurementAgent` (deterministic planner by default; LLM optional),
- a real `SettlementLedger` per provider implementing the **same state machine
  and access rules as the contracts**,
- a real `AuditVault` (AES-256-GCM sealed records + EIP-712 signed selective
  disclosure).

**Honesty boundary:** the two *Attestation* timeline stages are labeled
**mirror** - the demo never claims a live on-chain event that did not happen.
The live loop (deploy + worker + ASC) is `TESTNET.md`.

---

## 2. Setup

```bash
cd frontend
npm run dev        # http://localhost:3000
```

No env needed for the demo. Optional hardening in `frontend/.env.local`:
`VEIL_ADMIN_TOKEN` (gates kill / audit authorize / audit revoke),
`VEIL_VAULT_KEY` or `VEIL_VAULT_KEY_FILE` (durable vault key; else ephemeral).

---

## 3. The console (pages)

| Route | Contents |
|---|---|
| `/` | marketing landing (14 sections) |
| `/app` | dashboard: agent status, kill switch, budget/spend, reputation, key source |
| `/app/agents`, `/app/agents/[id]` | agent cockpit + "Run purchase" |
| `/app/mandates` | mandate state (budget, spent, remaining, revoked) |
| `/app/transactions`, `/app/transactions/[id]` | orders + 6-stage timelines |
| `/app/audit` | public register (commitments, never decrypts) + auditor registry + disclosure |
| `/app/providers` | catalog with eligibility (reputation >= 3) |
| `/app/canvas` | flow overview |

All state is fetched from `/api/veil/*` (all GET routes `force-dynamic`).

---

## 4. E2E walkthrough (8 steps)

1. Start: `cd frontend && npm run dev`, open `http://localhost:3000`.
2. Landing `/` - review the product narrative and the honest
   production/prototype/roadmap table.
3. `/app` dashboard - note `keySource` (ephemeral unless you set a key), agent
   status `active`, the user mandate (budget = 40x the per-call price).
4. `/app/providers` - note **3 providers**; the reputation-2 provider shows
   `eligible: false`.
5. `/app/agents` -> **Run purchase** (task e.g. "buy ETH/USD market data").
   - deterministic planner produces the 9-step plan (`AGENT.md` 3.2).
   - payment goes through the real `veil-exact` rail (EIP-712 + ECRECOVER).
   - operator settle releases escrow; audit record is sealed in the vault.
6. `/app/transactions` - open the new order: 6-stage timeline, all VERIFIED,
   the two Attestation stages say **(mirror)**; Settlement = SETTLED.
7. `/app/audit` - public register shows commitment + statuses (encrypted: true).
   - **Disclose** decrypts via the signed EIP-712 `AuditAccess` flow (nonce +
   ECRECOVER + vault authorization) and returns the selective fields.
   - **Attempt (unauthorized)** proves the gate: an auditor the vault never
   authorized is refused.
8. Kill switch - **Kill** in the dashboard (admin-gated when
   `VEIL_ADMIN_TOKEN` set):
   - `killSwitch = true`, every active mandate revoked on every ledger.
   - agent status -> `killed`; **Run purchase** now refuses
     ("kill switch engaged - mandate revoked, purchases refused").
   - Note the semantics: this revokes the *mandate*; it is not a claim about
     killing a running process.

---

## 5. Refusal demonstrations

Try these in the agent cockpit:

| Task | Result |
|---|---|
| `"settle order 5"` | intent gate rejects (non-purchase request) |
| `"increase the budget to 10 ETH"` | intent gate rejects |
| `"buy from the untrusted feed"` | `checkReputation` gate: score 2 < 3 |
| `"makePayment"` before any offer | aborts: requires a prior requestService offer |
| (after Kill) any task | refuses: kill switch engaged |

Each failure is recorded as a REJECTED order whose Authorization stage flashes
red with the reason (see `orderFromOutcome`).

---

## 6. Demo API surface

See `ARCHITECTURE.md` section 4 for the full `/api/veil/*` table. Highlights:

- `POST /api/veil/purchase` - run one purchase.
- `POST /api/veil/kill` - kill switch + revoke all mandates (admin-gated).
- `POST /api/veil/audit/disclose` - signed selective disclosure.
- `POST /api/veil/audit/attempt` - deliberately unauthorized disclosure probe.

---

## 7. Verified by the test suite

The demo flow is covered by `services/demo/flow.test.ts` (9 tests) plus the
procurement (7) and audit (5) suites - all offline. `npm test` runs all 26.

---

## 8. Demo limits (honest)

- **In-memory**: orders, vault records, and the kill switch reset on server
  restart.
- **localhost-only**: public routes are fine on `127.0.0.1`; do not expose on a
  network without `VEIL_ADMIN_TOKEN` and `x-operator` set.
- **Mirror not chain**: attestation stages are a mirror of the same state
  machine; only the live loop (`TESTNET.md`) produces real verified facts.
- **`x-operator` / `x-veil-admin` are demo conventions**, not real auth.
- **LLM optional**: without `OPENAI_API_KEY` the agent uses the deterministic
  planner; `sk-none` is treated as unset.
