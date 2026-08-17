# VEIL - AI Procurement Agent

This document describes the `ProcurementAgent` exactly as implemented in
`services/procurement/`: its 7 tools, how it plans, the deterministic gates that
bound every call, and the refusal behavior.

Companion docs: `ARCHITECTURE.md` (flow), `THREAT_MODEL.md` (T-A1/T-A2),
`PRIVACY_MODEL.md` (what it records).

---

## 1. Design principle

The agent is a **constrained purchaser**, not an administrator:

- It exposes only **7 tools** (5 read-only + `requestService` +
  `makePayment`).
- It **never** holds a settlement, refund, revoke, budget-change, verify, or
  mandate tool.
- The authoritative **settlement ledger** (not the agent) decides what may be
  paid. Every agent observation is re-checked against ledger truth before any
  money moves.
- The agent signs payments (EIP-712 `VeilPayment` via the provider adapter);
  the ledger still re-validates the mandate + budget at payment time and again
  at settlement (see `CONTRACTS.md`).

---

## 2. The 7-tool surface

| Tool | Read-only | Args | Behavior |
|---|---|---|---|
| `searchProviders` | yes | `serviceId` | providers offering the service with reputation >= 3 |
| `getProviderDetails` | yes | `provider` | full profile of one provider |
| `checkReputation` | yes | `provider` | score (1-5) from the ledger |
| `checkMandate` | yes | `serviceId?` | active mandates covering the service |
| `checkBudget` | yes | `serviceId`, `amountAtoms` | remaining >= amount on the ledger |
| `requestService` | no | `provider`, `serviceId`, `amountAtoms` | reserve a payment offer (no funds move) |
| `makePayment` | no | `orderId` | pay a **reserved** offer - the only payment path |

`assertSafeToolName` gates the name before execution: an unknown or privileged
tool name (e.g. `settle`, `refund`, `revoke`) is rejected even if the LLM
produced it.

---

## 3. Planning

### 3.1 Planner selection

- **Deterministic** (default): the rule-based `buildProcurementPlan` - the same
  9 steps every time (see 3.2).
- **LLM** (optional): when `OPENAI_API_KEY` is set and not `sk-none`, one OpenAI
  tools call is attempted (`gpt-4o-mini` by default, `OPENAI_MODEL` to change).
  On **any** config/parse/network error the agent soft-fails to the
  deterministic planner. It never fabricates an outcome.
- `forceDeterministic` skips the LLM entirely. `openai` is imported
  dynamically so its absence never breaks the module.

### 3.2 The deterministic 9-step plan

| # | Tool | Rationale |
|---|---|---|
| 1 | `searchProviders(serviceId)` | eligible discovery (reputation >= 3) |
| 2 | `getProviderDetails(provider)` | pick best provider |
| 3 | `checkReputation(provider)` | must be >= 3 |
| 4 | `checkMandate(serviceId)` | mandate covers the service |
| 5 | `checkBudget(serviceId, amountAtoms)` | remaining >= amount |
| 6 | `requestService(provider, serviceId, amountAtoms, orderId)` | reserve an offer; no funds move |
| 7 | `checkBudget(serviceId, amountAtoms)` | re-validate ledger before paying |
| 8 | `makePayment(orderId)` | the ONLY payment path |
| 9 | `checkMandate(serviceId)` | post-purchase: spent updated, mandate active |

Best provider = highest reputation, then lowest `pricePerCallAtoms`.

### 3.3 Intent gate (before any planning)

`parsePurchaseIntent` rejects non-purchase or privileged intents first:

- forbidden: settle, refund, revoke, increase/set budget, modify mandate,
  mark verified, deploy, withdraw, transfer funds.
- on match: throws `ProcurementPolicyError`; the agent refuses.

`detectServiceId` (LLM path) also falls back to the intent parser so the service
is always derived deterministically.

---

## 4. Deterministic gates during execution

Every tool result is checked as it comes back; the first failure aborts the run:

| Step result | Gate | Failure behavior |
|---|---|---|
| `searchProviders` | providers non-empty | abort: no eligible provider (reputation >= 3) |
| `checkReputation` | score >= 3 | abort: provider excluded |
| `checkMandate` | at least one active mandate | abort: no mandate covers the service |
| `checkBudget` | `affordable == true` | abort: budget breach (required vs remaining atoms) |
| `requestService` | offer returned | stores `lastOfferOrderId`; the ledger validated mandate + budget here |
| `makePayment` | order exists | `makePayment` without a prior offer aborts |

The `makePayment` step resolves its `orderId` from the prior `requestService`
offer automatically - you cannot pay a non-existent offer.

On a gate failure the run returns `{ ok: false, error }` with the partial
`results`, and the frontend flashes the order as failed/refused (see `DEMO.md`).

---

## 5. The LLM boundary (what the LLM can and cannot change)

| Decision | LLM influence | Hard floor |
|---|---|---|
| which tools exist | none (fixed schema, `openaiToolsSchema`) | `TOOL_NAMES` |
| tool names executed | none (LLM may suggest) | `assertSafeToolName` |
| service id | derived from calls, falls back to intent parser | `parsePurchaseIntent` |
| payment amount | suggested in args | ledger `checkBudget` + mandate |
| settlement / refund / mandate changes | none - not offered | intent gate + tool allowlist |
| outcome truth | none | ledger re-validation + tests |

The LLM is a planning convenience over a deterministic safety rail, never an
authority.

---

## 6. What the agent records

Via the audit rail (`PRIVACY_MODEL.md`), each purchase produces a
`TransactionRecord` whose **sensitive fields are sealed** (AES-256-GCM):
agent, provider, amount, authorization, payment/fulfillment/attestation/
settlement evidence. The public view shows only statuses + commitment.

---

## 7. Refusal examples (tested)

- `"settle order 5"` -> intent gate rejects before any planning
  (`non-purchase request`).
- `"increase the budget to 10 ETH"` -> intent gate rejects.
- `"buy X"` with no eligible provider -> `searchProviders` gate fails.
- A provider with reputation 2 -> `checkReputation` gate fails (eligibility is
  >= 3).
- `makePayment` before `requestService` -> aborts (`requires a prior
  requestService offer`).

These refusal paths are exercised by the procurement test suite.

---

## 8. Key hierarchy and secrets

- The agent does not hold a vault master key, the CC wallet key, or the admin
  token. The settlement ledger and vault are separate authorities.
- `OPENAI_API_KEY` is read from env (or passed explicitly) and is **never
  logged**; `sk-none` is treated as unset (envs often ship a placeholder).

---

## 9. Reputation model (as implemented)

- Reputation is a 1-5 score per provider, held in the ledger (mirror of
  `ReputationEngine`).
- **Eligibility rule: score >= 3** is enforced in `searchProviders`,
  `checkReputation`, and the deterministic planner's provider selection. It is a
  discovery-layer rule (see `THREAT_MODEL.md` section 4 for the on-chain
  boundary).
- The default runtime shop has three providers with reputations **5, 5, 2** -
  the `2` is excluded by discovery, which visibly demonstrates the gate in the
  console.

---

## 10. Configuration summary

| Setting | Source | Default |
|---|---|---|
| planner | `forceDeterministic` flag / `OPENAI_API_KEY` | deterministic |
| LLM model | `OPENAI_MODEL` / config | `gpt-4o-mini` |
| services offered | provider catalog (`SERVICE_MARKET_DATA`, `SERVICE_COMPUTE`) | market data + compute |
| mandate | registered on each provider ledger at runtime start | single user mandate |
| budget | mandate budget on the ledger | configured per runtime |

See `DEVELOPMENT.md` for how to run the agent in isolation and `DEMO.md` for the
console walkthrough.
