# VEIL — Phase 5: The AI Procurement Agent

The agent that **buys verified market-data services** (and any service a mandate
allows) on the user's behalf — while the **contracts (SettlementLedger) stay the
authority**. The agent is given a deliberately tiny tool surface and is never
granted a privileged capability.

```
User (mandate owner)
 └─ Mandate  budget / serviceId / expiry      (SettlementLedger, = authority)
      └─ AI Procurement Agent                  (9-step plan, 7 tools)
           ├─ searchProviders / getProviderDetails / checkReputation   (who is eligible)
           ├─ checkMandate / checkBudget                                (is it allowed?)
           ├─ requestService  ->  makePayment                            (the ONLY payment path)
           └─ (no settle / revoke / budget / verify / escrow tools exist for the agent)
```

## 1. Security rule (unchanged, now enforced in code)

The agent must NEVER:
- increase or change the budget,
- revoke / modify the mandate,
- bypass escrow,
- mark payment / fulfillment verified,
- call privileged settlement functions.

The contracts remain the authority: even after the agent "buys", the escrow is
**Locked** and only the operator (end-user) can settle through the x402 rail.

## 2. The 7-tool surface (exactly, with a comment marker)

Preserved 5 + 2 split when there were 7 tools:

| # | tool              | kind            | does |
|---|-------------------|-----------------|------|
| 1 | `searchProviders` | read-only       | providers offering `serviceId` with reputation ≥ 3 |
| 2 | `getProviderDetails` | read-only    | provider profile (services, operator, mandates) |
| 3 | `checkMandate`    | read-only       | active mandate(s) covering a service (ledger mirror) |
| 4 | `checkBudget`     | read-only       | remaining budget ≥ amount on the authoritative ledger |
| 5 | `checkReputation` | read-only       | star score (1-5; 0 unrated; **< 3 excluded**) |
| 6 | `requestService`  | state-changing  | validate + reserve a payment offer (no funds move) |
| 7 | `makePayment`     | state-changing  | pay the reserved offer — **the ONLY payment path** |

There is **no** tool for settle / refund / revoke / budget / verify / escrow.
Any unknown or privileged-looking name is rejected by `assertSafeToolName`
(`services/procurement/tools.ts`).

## 3. Mandate rules driving refusals

Mandate policy in `services/procurement/tools.ts` `buildOffer` (the ledger
decides):

- allowed services = `mandate.serviceId`
- budget = `budget - spent`
- validity = active, not revoked, not expired, serviceId match,
  remaining budget ≥ amount

When a rule fails the agent (or LLM) must stop **before** `requestService` and
report a clean refusal (`BudgetNotCompliant`, `MandateDoesNotCoverService`, …).

## 4. Deterministic 9-step plan (`services/procurement/plan.ts`)

1. `searchProviders(serviceId)` — eligible discovery (reputation ≥ 3)
2. `getProviderDetails(provider)` — inspect chosen provider
3. `checkReputation(provider)` — must be ≥ 3
4. `checkMandate(serviceId)` — mandate covers the service
5. `checkBudget(amount)` — remaining ≥ amount
6. `requestService(provider, serviceId, amount)` — reserve an offer
7. `checkBudget(amount)` — re-validate the ledger before paying
8. `makePayment(orderId)` — pay (only valid after a `requestService`)
9. `checkMandate(serviceId)` — post-purchase: spent updated, mandate active

Amounts are **BigInt atoms** only for `pricePerCallAtoms` and order amounts; all
optional "whole dollar" entries use `string`/`number` so JSON round-trips never
hit the classic BigInt serialization bug.

## 5. Optional LLM planner with soft-fail (`services/procurement/agent.ts`)

- If `OPENAI_API_KEY` is present and **not** `sk-none`, one OpenAI tools call is
  attempted; the returned tool calls are validated against the same 7-tool
  allowlist (privilege gate applies to LLM output too).
- On **any** config/parse error → **deterministic fallback**; the agent never
  fabricates an outcome.
- `openai` is imported **dynamically** at call time — never at module load — and
  a missing package is itself a soft-fail trigger.

## 6. Ledger / server extensions (authority plumbing)

- `SettlementLedger` (`services/provider/ledger.ts`):
  - `registerReputation` / `reputationOf` / `providerReputations` (1-5 stars)
  - `activeMandateOf` / `activeMandates` (not revoked, not expired)
  - `recordOrderSupplement` / `orderSupplement` (service name, description,
    provider reputation injected at checkout)
- `VeilProvider` HTTP server (`services/provider/server.ts`):
  - `GET /api/providers` — provider profile + catalog + reputation
  - `GET /api/mandates` — active mandates
  - `GET /api/orders/:id` — now includes `serviceName` / `serviceDescription` /
    `providerReputation`
  - `recordAgentPayment` prefers the caller's **active mandate** for the service
    (falls back to a default; never creates a second conflicting mandate).

## 7. Tests (`services/procurement/procurement.test.ts`) — `npm run test:procurement`

| # | scenario | proves |
|---|----------|--------|
| 1 | success | order 1189 reserved, paid, escrow Locked → operator settle → spent debited exactly |
| 2 | budget breach | refusal before `requestService`; `spent` stays 0 |
| 3 | service breach | mandate covers market-data, not compute → refusal |
| 4 | revoked mandate | refusal |
| 5 | state authority | stranger cannot settle; only operator settles; escrow Released |
| 6 | privilege guard | no settlement/privilege tools; `makePayment` requires a `requestService` offer; non-purchase intents refused |
| 7 | deterministic fallback | openai missing/invalid key → soft falls back to the rule-based planner |

Run: `npm run typecheck && npm test` (21 tests: x402 + provider flow + procurement).

## 8. Demo — `npm run demo:procurement`

Two reputable providers + one excluded low-rep provider (score 2 < 3). The agent
buys from the cheapest reputable one, the operator settles, a privileged intent
is refused, and a budget breach is refused with zero funds charged.