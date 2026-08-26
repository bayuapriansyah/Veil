# VEIL - Development Guide

How to work on VEIL: layout, scripts, tests, and the honest notes about what
runs in this environment and what needs a different machine.

Companion docs: `DEPLOYMENT.md` (deploy), `TESTNET.md` (live reproduction),
`ARCHITECTURE.md` (system layout).

---

## 1. Repository layout

```
VEIL/
|- contracts/
|  +- src/            production contracts (Solidity ^0.8.23)
|  +- test/           Foundry suite (VeilFoundation.t.sol) - ready, needs forge
|- services/
|  |- attestation/    worker, proof generation, config, live-check
|  |- provider/       x402 rail, veil-exact adapter, SettlementLedger mirror
|  |- procurement/    ProcurementAgent (7 tools), shop, planner, demo
|  |- audit/          AuditVault, EIP-712 AuditAccess, crypto, server, demo
|  +- demo/           end-to-end simulation + flow tests
|- frontend/
|  |- app/            / landing + /app console (dashboard, agents, mandates,
|  |                  transactions, audit, providers, canvas)
|  +- lib/            veil-runtime.ts (singleton), veil-client.ts, use-poll.ts
|- script/
|  |- deploy.ts       forge/cast deployment orchestrator
|  +- compile-check.js  Standard-JSON compile harness (solc 0.8.23)
+- .env.example
+- package.json
```

---

## 2. Getting started

```bash
# root deps
npm install

# frontend deps
cd frontend && npm install && cd ..

# run the console demo
cd frontend && npm run dev    # http://localhost:3000
```

The services run **in-process** inside the Next runtime via
`frontend/lib/veil-runtime.ts` (a `globalThis` singleton - see
`ARCHITECTURE.md` section 6 for why). No separate server processes needed for
the console.

---

## 3. Scripts

### Root (`package.json`)

| Script | Command | Purpose |
|---|---|---|
| `test` | `tsx --test` x4 suites | **26 tests / 4 suites** (x402=5, demo flow=9, procurement=7, audit=5) |
| `test:audit` | `tsx --test services/audit/audit.test.ts` | vault + disclosure suite |
| `test:procurement` | `tsx --test services/procurement/procurement.test.ts` | agent gates + refusals |
| `typecheck` | `tsc --noEmit` | services + scripts typecheck |
| `compile-check` | `node script/compile-check.js` | **19 contracts** via solc 0.8.23 |
| `worker` | `tsx services/attestation/worker.ts` | live Attestcoin worker |
| `live-check` | `tsx services/attestation/live-check.ts` | read-only testnet canary |
| `deploy` | `tsx script/deploy.ts` | forge/cast deploy |
| `demo` | `tsx services/demo/sim.ts` | in-process end-to-end sim |
| `demo:provider` | `tsx services/provider/server.ts` | standalone provider HTTP server |
| `demo:procurement` | `tsx services/procurement/demo.ts` | agent demo |
| `demo:audit` | `tsx services/audit/demo.ts` | vault demo |
| `build:contracts` / `test:contracts` | `forge build` / `forge test` | 19/19 pass |

### Frontend (`frontend/package.json`)

| Script | Purpose |
|---|---|
| `dev` | `next dev` |
| `build` | `next build` |
| `start` | `next start` |
| `typecheck` | `tsc --noEmit` |

---

## 4. Testing

**Full suite:** `npm test` (root) - 26 tests across 4 suites. All run without a
network or wallets (they exercise the real code paths in-process):

| Suite | File | Covers |
|---|---|---|
| x402 | `services/provider/x402.test.ts` | 5 tests: handshake, EIP-3009 crypto, veil-exact adapter, ECRECOVER |
| demo flow | `services/demo/flow.test.ts` | 9 tests: full purchase lifecycle + refusal cases |
| procurement | `services/procurement/procurement.test.ts` | 7 tests: agent gates, budget, mandate, refusals |
| audit | `services/audit/audit.test.ts` | 5 tests: vault seal/open, authorization, nonce, tamper |

**Contracts:** `contracts/test/VeilFoundation.t.sol` is written and will run
with `forge test` - not runnable on this box (no Foundry binary).

**Frontend:** no unit-test runner configured; verification is `npm run build`
plus manual E2E against `http://localhost:3000`.

---

## 5. Compile / typecheck reality on this box

- `node script/compile-check.js` uses a custom Standard-JSON harness because the
  official `solc` npm package cannot install on this Windows box
  (`EBADPLATFORM` from a transitive `n@9.2.3`). It loads the Emscripten `solc`
  from the npx cache and resolves `@openzeppelin/` + `@gluwa/` remappings from
  `node_modules`. Result: **19 contracts compile** with `0.8.23`.
- `forge build` / `forge test` — **19/19 pass** (forge-std installed).

---

## 6. Common dev tasks

### Add a provider to the catalog
1. Add its adapter entry in `services/provider/adapter.ts` (service + price +
   reputation).
2. `services/provider/ledger.ts` holds the per-provider `SettlementLedger`.
3. Wire it in `frontend/lib/veil-runtime.ts` if the console should see it.

### Add an agent tool
1. Add the name to `TOOL_NAMES` in `services/procurement/types.ts`.
2. Implement it in `services/procurement/tools.ts` and register in
   `createAgentTools`.
3. Add it to `openaiToolsSchema` in `services/procurement/agent.ts` if the LLM
   planner should offer it.
4. Keep the safety gate: `assertSafeToolName` must reject it if it is
   privileged.

### Change vault key handling
- `services/audit/crypto.ts` `loadVaultKey` - add sources there; keep the
  "never hardcoded, invalid env throws" rule.

### Change the console
- Pages under `frontend/app/app/*`; API under `frontend/app/api/veil/*`;
  shared client in `frontend/lib/veil-client.ts` (browser-safe, no node
  imports).

---

## 7. Environment

See `.env.example`. Demo runs with no env at all (ephemeral vault key, open
admin). Live Attestcoin steps need the env vars listed in `DEPLOYMENT.md`
section 3.
