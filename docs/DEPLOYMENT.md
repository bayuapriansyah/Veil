# VEIL - Deployment

This document covers both realities of VEIL:

1. **The demo** (frontend + in-process services) - runs locally with zero
   blockchain access.
2. **The on-chain deployment** (Sepolia + Creditcoin CC3 Testnet) - executed
   via `script/deploy.ts` (real `forge`/`cast`), and **blocked in this
   environment** because no Foundry binary / funded wallets are available here.

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

- `forge` + `cast` on PATH (Foundry). Not installed on this Windows box
  (`foundryup` requires bash); see `ATTESTCOIN.md` section 6.
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
                  # generates real proofs, submits to the ASC
npm run live-check  # read-only canary against the live testnet
```

At this point the console's purchase flow can also drive
`VeilSource.recordAgentPayment` / `recordFulfillment` (see `TESTNET.md`).

---

## 3. Environment reference (`.env.example`)

| Variable | Required for | Notes |
|---|---|---|
| `SOURCE_CHAIN_KEY` | live | CC3-internal chain key; verified `1` = Sepolia |
| `PROOF_BUILDER_URL` | live | verified live at `https://prover.cc3-testnet.creditcoin.network` |
| `SOURCE_CHAIN_ID` | live | `11155111` (Sepolia) |
| `SOURCE_CHAIN_RPC_URL` | live | required for deploy/worker |
| `CREDITCOIN_RPC_URL` | live | `https://rpc.cc3-testnet.creditcoin.network` (chainId `102031`) |
| `SOURCE_CHAIN_CONTRACT_ADDRESS` | live | after deploy |
| `USC_ATTESTATION_RECEIVER_ADDRESS` | live | after deploy |
| `SETTLEMENT_ENGINE_ADDRESS` | live | after deploy (used by the engine wiring) |
| `CREDITCOIN_WALLET_PRIVATE_KEY` | live | proof submit + deploy signer |
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

| Item | Status |
|---|---|
| `forge` / `cast` installed | **BLOCKED** - not present; foundryup needs bash |
| Deploy `VeilSource` (Sepolia) | **BLOCKED** - needs funded Sepolia wallet + RPC key |
| Deploy ASC + decoder (CC3) | **BLOCKED** - needs funded CTC wallet (faucet) |
| Real proof for a real event | **BLOCKED** - needs a mined source event first |
| Live `npm run worker` | **BLOCKED** - needs the above |
| Compile + typecheck + tests | **DONE** in this environment |

Nothing above was fabricated. The deployment script is real and will run
wherever Foundry + funded wallets exist (`TESTNET.md` is the walkthrough).
