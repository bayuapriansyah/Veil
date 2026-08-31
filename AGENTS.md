# AGENTS.md — VEIL Project Context

> Read this file first. It gives you full context on the VEIL project so you can
> work effectively without reading 14+ docs.

---

## 1. What is VEIL?

**VEIL (Verifiable Economic Infrastructure Layer)** is an AI agent payment and
settlement system built on Creditcoin. It lets autonomous AI agents purchase
data/services from providers, with every transaction cryptographically proved
on-chain and auditable.

**Hackathon:** BUIDL CTC 2026 Fall (deadline: 6 Sep 2026 23:59 ET)
**Team:** Bayu Priansyah (`@bayuapriansyah`)

---

## 2. Current State (LIVE)

| Feature | Status |
|---------|--------|
| Provider x402 payment rail | ✅ Live |
| AI procurement agent (7 tools) | ✅ Live |
| On-chain recording (Sepolia) | ✅ Live |
| Attestcoin worker (CC3 proof) | ✅ Live |
| Order settlement (CC3) | ✅ Live |
| A2A agent-to-agent delegation | ✅ Live |
| Wallet connect (wagmi) | ✅ Live |
| On-chain agent registry (CC3) | ✅ Live |
| Privacy vault (AES-256-GCM) | ✅ Live |
| Audit PDF export | ✅ Live |
| Full e2e verified | ✅ Order 603003 |

**Last verified live e2e:** Order 603003 — payment → fulfillment → attestation
→ settlement, all on-chain.

---

## 3. Architecture

```
Sepolia (source chain)          Creditcoin CC3 (settlement chain)
┌──────────────────┐           ┌──────────────────────────────┐
│  VeilSource.sol  │──worker──▶│  AttestationReceiver (ASC)   │
│  emits events    │           │  SettlementEngine             │
└──────────────────┘           │  MandateManager               │
                               │  EscrowManager                │
                               │  ReputationEngine             │
                               │  VeilRegistry                 │
                               └──────────────────────────────┘

Services (Node.js/TypeScript):
  services/attestation/   Worker + proof generation
  services/provider/      x402 HTTP rail + payment verification
  services/procurement/   AI agent + deterministic planner
  services/audit/         AES-256-GCM vault + EIP-712 grants
  services/agent-b/       Agent B server (A2A delegation)

Frontend (Next.js 14 app router):
  /                       Marketing landing
  /app                    Operations console
  /app/agents             On-chain agent registry
  /app/audit              Audit panel + PDF export
  /app/transactions       Transaction detail + explorer links
```

---

## 4. Deployed Contracts

### Sepolia (Chain ID 11155111)
| Contract | Address |
|----------|---------|
| VeilSource | `0x105C47953A714F15749dF29394487217c7016B29` |

### Creditcoin CC3 (Chain ID 102031)
| Contract | Address |
|----------|---------|
| AttestationReceiver | `0x5E2ECc270dE9E3202f9331d52bA7073B1319c62c` |
| MandateManager | `0xD2CaB58eBD729580f00E6a8260dA2d410de6560E` |
| EscrowManager | `0x9b6CC7C2Bcea8Ef9CAb92D818f8071c045762B37` |
| ReputationEngine | `0x1b5056CB0dC71f6f36749548CDc3E1D2cc468587` |
| SettlementEngine | `0xD99511f66bFa5B16AD7e4fB504e359f69E57092e` |
| ZKReceiptVerifier | `0x1D35b6381A55970fbE7Afe11EB96350147Bc6031` |
| VeilRegistry | `0x6d9DCfAFC1Ee54Dcc1922d3d6BfC4C03402500eE` |
| EvmV1Decoder | `0x912F3e988d0D8c4b6BD4671bE5D74664A4D24a65` |

---

## 5. Wallets (gitignored — DO NOT commit keys)

| Wallet | Address | Chain | Role |
|--------|---------|-------|------|
| Deployer | `0x836b…fe9` | Both | Contract deployment |
| Agent B | `0x34252d…60aAF2` | Sepolia | `recordAgentPayment` signer |
| Provider | `0xEaF93…4814` | Sepolia | x402 provider signing |
| Agent B (key) | `0x910339…` | — | Private key for Agent B |
| Provider (key) | `0xd504e4…` | — | Private key for Provider |
| User (MetaMask) | `0x15621E…` | Sepolia | User browser wallet |

---

## 6. Environment Variables

Root `.env` + `frontend/.env` — both must be set for production mode.

**Critical production vars:**
```
VEIL_MODE=production                          # auto-detected if keys present
SOURCE_CHAIN_WALLET_PRIVATE_KEY=0x9103...    # Agent B key (recordAgentPayment)
SOURCE_CHAIN_PROVIDER_PRIVATE_KEY=0xd504...  # Provider key (x402 signing)
SOURCE_CHAIN_CONTRACT_ADDRESS=0xe81F...771a  # VeilSource on Sepolia
CREDITCOIN_RPC_URL=https://rpc.cc3-testnet.creditcoin.network
USC_ATTESTATION_RECEIVER_ADDRESS=0x1eD3...e4FA
SETTLEMENT_ENGINE_ADDRESS=0xc593...f826
ESCROW_MANAGER_ADDRESS=0x9b6C...2B37
MANDATE_MANAGER_ADDRESS=0xD2Ca...560E
REPUTATION_ENGINE_ADDRESS=0x1b50...8587
ZK_VERIFIER_ADDRESS=0x1D35...6031           # ZKReceiptVerifier (Groth16)
CREDITCOIN_WALLET_PRIVATE_KEY=0x836b...fe9  # Deployer key (worker CC3 txs)
NEXT_PUBLIC_CC3_RPC_URL=https://rpc.cc3-testnet.creditcoin.network
NEXT_PUBLIC_VEIL_REGISTRY_ADDRESS=0x6d9D...0eE
```

---

## 7. How to Run

```bash
# Install
npm install

# Run all tests (50 tests)
npm test

# Typecheck
npx tsc --noEmit

# Frontend dev server
cd frontend && npm run dev        # http://localhost:3000

# Worker (polls Sepolia, proves on CC3, auto-settles)
npm run worker

# Agent B server (A2A delegation target)
npm run agent-b                   # port 8081

# Replay failed attestation recordings
npm run replay:attestations
```

---

## 8. Key Files & Roles

```
services/attestation/
  worker.ts          Attestcoin worker — polls Sepolia, proves on CC3
  record.ts          recordAgentPayment() + recordFulfillment() (soft-fail)
  replay.ts          Replays failed recordings from error queue
  config.ts          Worker env var resolution

services/provider/
  server.ts          x402 provider — payment verification, fulfillment
  x402.ts            EIP-3009 exact/veil-exact payment handler
  hardening.ts       Time-window, nonce replay, amount enforcement

services/procurement/
  shop.ts            ProcurementShop — makePayment, recordAgentPayment call
  agent.ts           ProcurementAgent — 7 tools, deterministic planner
  flow.ts            Flow control — purchase, delegate, A2A

services/audit/
  vault.ts           AES-256-GCM sealed vault, publicView, attachAttestation
  types.ts           PublicTxView, EvidenceBundle, ProtectedData

services/agent-b/
  server.ts          Agent B HTTP server (A2A delegation target)
  executor.ts        Executes delegated tasks

frontend/
  lib/veil-client.ts         API client, SEPOLIA_EXPLORER, CC3_EXPLORER constants
  lib/veil-runtime.ts        RuntimeOrder, purchase(), recordAudit()
  lib/audit-pdf.ts           PDF generator (jsPDF + jspdf-autotable)
  components/audit-panel.tsx Audit panel with Export PDF button
  components/flow-control.tsx Purchase console (Direct/Delegate tabs)
```

---

## 9. Known Gotchas (CRITICAL)

### Timestamp Bug
Vault stores `createdAt` as **seconds** (`Math.floor(Date.now() / 1000)`).
Orders store `createdAt` as **milliseconds** (`Date.now()`).
`formatDate()` in audit-pdf.ts uses `ts * 1000` — this is correct for vault
seconds. `formatNow()` uses `new Date()` directly for current time.

### JSON.stringify Strips `undefined`
`recordAgentPayment` returns `{ txHash: undefined }` on soft-fail.
`JSON.stringify` strips `undefined` values. Always use `null` instead of
`undefined` for fields that must survive serialization.

### Soft-Fail Behavior
`recordAgentPayment` in shop.ts is soft-fail — if RPC fails or wallet is
unfunded, the purchase still completes but `sourceTx` is empty. The vault
labels it `attestationStatus: 'mirror'`.

### In-Memory Vault
The audit vault is **in-memory** (lost on Next.js dev server restart).
Historical order data only persists if the server stays running.

### Attestcoin Worker Must Be Running
Without `npm run worker`, no orders get attested on CC3. The worker:
1. Polls Sepolia every ~10s for AgentPayment/FulfillmentReceipt events
2. Waits for CC3 block attestation lag (~30 blocks, ~6 min)
3. Generates proof via `prover.cc3-testnet.creditcoin.network`
4. Submits to AttestationReceiver on CC3
5. POSTs to `/api/veil/audit/attach` to update vault

### orderIdSeed
`orderIdSeed` in veil-runtime.ts starts at `603_000n`. Agent B uses `700_000n`
range. **Do not restart without incrementing** or you'll hit order ID reuse.

### CC3 Attestation Lag
~30 blocks (~6 minutes) behind Sepolia. Worker waits for blocks to be
attested before generating proof. This is expected.

---

## 10. Code Conventions

- **TypeScript** — strict mode, no `any` where avoidable
- **ethers v6** — `JsonRpcProvider`, `Wallet`, `Contract`, `keccak256`
- **Tests** — `node:test` + `node:assert`, run via `tsx --test`
- **No comments** in production code unless requested
- **Git submodules** — `forge-std` + `openzeppelin-contracts` in `contracts/lib/`
- **Frontend** — wagmi v2.12.0 + viem v2.21.0, Next.js 14 app router
- **Imports** — use `viem` for chain definitions, `ethers` for signing
- **Env vars** — loaded via `dotenv`, fallback defaults in code
- **Error handling** — soft-fail for on-chain recording (never block purchase flow)

---

## 11. Transaction Flow (End-to-End)

```
1. User clicks "Purchase" in frontend
2. POST /api/veil/purchase → purchase() → makePayment()
3. makePayment() calls recordAgentPayment() on VeilSource (Sepolia)
   → soft-fail: if RPC/wallet issue, continues without on-chain record
4. recordAudit() stores in vault with sourceTx + attestationStatus
5. Worker detects AgentPayment event on Sepolia
6. Worker waits for CC3 block attestation
7. Worker generates proof via ProofBuilder service
8. Worker submits proof to AttestationReceiver on CC3
9. Worker calls POST /api/veil/audit/attach → vault.attachAttestation()
10. Vault updates: attestationStatus='verified', attestationTx=cc3TxHash
11. Worker auto-settles if both payment + fulfillment verified
12. Frontend shows full on-chain proof in audit panel
```

---

## 12. What NOT to Do

- Do NOT commit `.env` files or wallet private keys
- Do NOT change `orderIdSeed` without checking Agent B's range (700000+)
- Do NOT use `undefined` for fields that go through JSON serialization
- Do NOT assume the vault persists across server restarts
- Do NOT call `recordAgentPayment` synchronously in tests without mocking
- Do NOT use `formatDate(Date.now())` — use `formatNow()` instead
- Do NOT change contract addresses without redeploying + updating all env vars
- Do NOT push to git without running `npm test` + `npx tsc --noEmit`

---

## 13. References

| Topic | File |
|-------|------|
| Full architecture | `docs/ARCHITECTURE.md` |
| AI agent design | `docs/AGENT.md` |
| Smart contracts | `docs/CONTRACTS.md` |
| Privacy model | `docs/PRIVACY_MODEL.md` |
| Threat model | `docs/THREAT_MODEL.md` |
| Deployment | `docs/DEPLOYMENT.md` |
| Development setup | `docs/DEVELOPMENT.md` |
| Testing | `docs/TESTNET.md` |
| Demo guide | `docs/DEMO.md` |
| Team info | `TEAM.md` |
| Main README | `README.md` |
