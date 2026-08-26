# VEIL - Deployment

This document covers both realities of VEIL:

1. **The demo** (frontend + in-process services) - runs locally with zero
   blockchain access.
2. **The on-chain deployment** (Sepolia + Creditcoin CC3 Testnet) - executed
   via `script/deploy.ts` (real `forge`/`cast`) and **live on testnet** since
   Phase 8 (addresses in section 5 and `TESTNET.md`).

Companion docs: `ATTESTCOIN.md` (blocker inventory), `TESTNET.md` (reproduction
walkthrough), `CONTRACTS.md` (what gets deployed).

---

## 1. The demo (no blockchain needed)

Prereqs: Node.js 20+.

```bash
# from repo root: install root + frontend deps
npm install
cd frontend && npm install && cd ..

# run the demo (frontend dev server; services run in-process)
cd frontend
npm run dev          # http://localhost:3000
```

The provider + audit services are instantiated **inside the Next.js runtime**
(`lib/veil-runtime.ts`), so a single `npm run dev` gives you the whole console.
There is no `.env.local` in the demo by default - `VEIL_ADMIN_TOKEN` unset means
demo mode is open (localhost only).

Optional hardening for the demo:

```bash
# frontend/.env.local
VEIL_ADMIN_TOKEN=<your-token>     # gates kill / audit authorize / audit revoke
VEIL_VAULT_KEY=<64-hex>           # durable vault key (else ephemeral)
```

---

## 2. On-chain deployment (Sepolia + CC3 Testnet)

### 2.1 What gets deployed and where

| # | Contract | Chain | Why |
|---|---|---|---|
| 1 | `EvmV1Decoder` (library) | CC3 | decoding dependency of the ASC |
| 2 | `AttestationReceiver` (ASC) | CC3 | proof verification + verified facts |
| 3 | `VeilSource` | Sepolia | emits the events to prove |
| 4 | `registerVeilSource(source)` | CC3 | allowlist the source contract |

### 2.2 Prereqs

- `forge` + `cast` on PATH (Foundry 1.5.1; `forge create` needs `--broadcast`).
- Funded wallets: CTC on CC3 Testnet (Discord faucet) for the ASC + proofs;
  Sepolia ETH for `VeilSource` and source-chain calls.
- `.env` populated per `.env.example`:
  `SOURCE_CHAIN_RPC_URL`, `CREDITCOIN_WALLET_PRIVATE_KEY`,
  optionally `USC_DECODER_LIBRARY_ADDRESS`.

### 2.3 The deploy script (`script/deploy.ts`)

Runs the real CLI (no fabrication):

```bash
npm run deploy
```

Sequence (mirrors the official loan-flow procedure, verified in Phase 0):

1. **EvmV1Decoder** - `forge create` the library on CC3, or reuse
   `USC_DECODER_LIBRARY_ADDRESS` if already set.
2. **AttestationReceiver** - `forge create` with
   `--libraries "@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol:EvmV1Decoder:<decoder_addr>"`
   so the library is linked.
3. **VeilSource** - `forge create` on the source chain (Sepolia RPC).
4. **registerVeilSource** - `cast send` the source address into the ASC
   (owner only).

The script prints the addresses to record in `.env`:

```
SOURCE_CHAIN_CONTRACT_ADDRESS=<sourceAddr>
USC_ATTESTATION_RECEIVER_ADDRESS=<ascAddr>
USC_DECODER_LIBRARY_ADDRESS=<decoderAddr>
```

### 2.4 After deploy

```bash
npm run worker    # watches Sepolia events, waits for attestation,
                  # generates real proofs, submits to the ASC,
                  # then POSTs the proof tx to the console audit vault
npm run live-check  # read-only canary against the live testnet
```

At this point the console's purchase flow can also drive
`VeilSource.recordAgentPayment` / `recordFulfillment` (see `TESTNET.md`).
Purchases sign with the **dedicated agent wallet** (`SOURCE_CHAIN_WALLET_PRIVATE_KEY`),
so the operator's deployer key never appears as the recurring on-chain identity;
the agent wallet only needs a small Sepolia ETH balance for gas.

---

## 3. Environment reference (`.env.example`)

| Variable | Required for | Notes |
|---|---|---|
| `SOURCE_CHAIN_KEY` | live | CC3-internal chain key; verified `1` = Sepolia |
| `PROOF_BUILDER_URL` | live | verified live at `https://prover.cc3-testnet.creditcoin.network` |
| `SOURCE_CHAIN_ID` | live | `11155111` (Sepolia) |
| `SOURCE_CHAIN_RPC_URL` | live | required for deploy/worker |
| `SOURCE_CHAIN_POLL_RPC_URL` | live (opt) | dedicated RPC for the worker's `eth_getLogs` polling |
| `WORKER_AUDIT_ATTACH_URL` | live (opt) | worker POSTs the verified proof tx to the console audit vault |
| `CREDITCOIN_RPC_URL` | live | `https://rpc.cc3-testnet.creditcoin.network` (chainId `102031`) |
| `SOURCE_CHAIN_CONTRACT_ADDRESS` | live | after deploy |
| `USC_ATTESTATION_RECEIVER_ADDRESS` | live | after deploy |
| `SETTLEMENT_ENGINE_ADDRESS` | live | after deploy (used by the engine wiring) |
| `CREDITCOIN_WALLET_PRIVATE_KEY` | live | proof submit + deploy signer |
| `SOURCE_CHAIN_WALLET_PRIVATE_KEY` | live | **dedicated agent wallet** that signs Sepolia `AgentPayment` records from the frontend rail (address hygiene: never the deployer key) |
| `USC_DECODER_LIBRARY_ADDRESS` | optional | skip decoder redeploy |
| `VEIL_PROVIDER_ADDRESS` | demo | provider's payTo address |
| `PROVIDER_OPERATOR_ADDRESS` | demo | gates `/api/settle`, `/api/refund` |
| `PROVIDER_PORT` | demo | default `8080` |
| `VEIL_VAULT_KEY` / `VEIL_VAULT_KEY_FILE` | demo (prod) | 64-hex vault key or key file |
| `AUDIT_OPERATOR_ADDRESS` | demo | gates vault record/authorize/revoke |

The provider `veil-exact` scheme is a documented vendor adapter - not official
x402 (see `.env.example` header + `ARCHITECTURE.md` honesty table).

---

## 4. Verification commands

| Check | Command | Expect |
|---|---|---|
| contracts compile | `node script/compile-check.js` | 19 contracts, 0.8.23 |
| services typecheck | `npm run typecheck` | exit 0 |
| tests | `npm test` (root) | 26 tests / 4 suites pass |
| frontend build | `cd frontend && npm run build` | builds clean |
| live canary | `npm run live-check` | read-only testnet checks |

---

## 5. Blocker inventory for live deployment here

Live deployment was **fully executed** in this environment on CC3 Testnet +
Sepolia (see `TESTNET.md` section 5.1 for the proof evidence table).

| Item | Status |
|---|---|
| `forge` / `cast` installed | **DONE** - `forge`/`cast` 1.5.1 at `C:\foundry\bin` (add to `PATH` per shell) |
| Deploy `VeilSource` (Sepolia) | **DONE** - `0xbe2d0793344e656690be44b81128BbF0EDa6F93c` |
| Deploy ASC + decoder (CC3) | **DONE** - ASC `0x071ff3210EA7619B7065ea24058030464093Dccd`, decoder `0x4eF11C369D9CAd4Fe68894a8B1D71Bc177c80b26` |
| Register `VeilSource` on ASC | **DONE** - `veilSource()` returns the Sepolia address |
| Real proof for a real event | **DONE** - 8/8 events proven & submitted (see `TESTNET.md` 5.1), including agent-wallet purchases attached to the live audit vault |
| Live `npm run worker` | **DONE** - retries pending proofs every poll; survives RPC resets |
| Compile + typecheck + tests | **DONE** in this environment |

Deployment notes for reproduction: `forge` 1.5.1 requires `--broadcast` on
`forge create` (already baked into `script/deploy.ts`), and `forge build` needs
`--skip "contracts/test/*"` (forge-std is installed but test deps managed separately). After a restart the
worker re-scans from the current block by default — pass `WORKER_FROM_BLOCK` to
re-ingest older events that have not been proven yet.
