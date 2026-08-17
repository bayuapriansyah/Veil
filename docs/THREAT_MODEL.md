# VEIL - Threat Model

This document is a **functional** threat model: what an attacker can and cannot
do against VEIL as built, which layers enforce each boundary, and the honest
residual risks that remain by design. It does not claim security that is not
implemented.

Companion docs: `CONTRACTS.md` (the gate list), `ATTESTCOIN.md` (proof trust
root), `PRIVACY_MODEL.md` (vault), `AGENT.md` (agent-side gates).

---

## 1. Trust boundaries (what is authoritative where)

| Boundary | Authority | Enforced by |
|---|---|---|
| Source-chain facts (payment, fulfillment) | Ethereum Sepolia | `VeilSource.sol` |
| Cross-chain verification | Creditcoin native verifier | precompile `0x0FD2` inside `AttestationReceiver` |
| Settlement on Creditcoin | `SettlementEngine` gates | ASC-verified facts + mandate + escrow identity |
| Demo ledger states (console) | in-memory `SettlementLedger` | same state machine + access rules as contracts |
| VEIL data at rest | `AuditVault` | AES-256-GCM sealed fields, auditor registry, nonces |
| Local demo admin actions | `VEIL_ADMIN_TOKEN` (when set) | `x-veil-admin` header check on destructive routes |

The two "demo" authorities (ledger, admin token) are localhost conventions, not
real distributed security. Everything else above maps to actual code paths.

---

## 2. Threat table

Legend: **P** = payment/fulfillment path, **A** = agent path, **C** = contracts,
**V** = vault/privacy, **O** = operator/service, **D** = demo/admin.

### T-P1 Agent payment never happened, provider fabricates proof
- **Impact:** provider paid without a real payment.
- **Blocked by:** the ASC only marks verified after `verifyAndEmit` accepts a
  Merkle + continuity proof covering the real source-chain transaction; a
  fabricated proof makes the call revert (`ATTESTCOIN.md`).
- **Residual:** you must trust Creditcoin's attestation of Sepolia blocks
  (inherent to the chain, not VEIL).

### T-P2 Provider forges a fulfillment receipt
- **Blocked by:** `VeilSource.recordFulfillment` requires `msg.sender ==
  orderProvider` (hardening G1); the ASC additionally requires the event to come
  from the registered `veilSource` and the receipt status to be SUCCESS.
- **Residual:** none within the code path; a provider can of course lie about
  *service quality* (out of scope - off-chain).

### T-P3 Proof replay (submit the same proof twice)
- **Blocked by:** `processedQueries[queryId]` in the ASC; `queryId` is derived
  from `(chainKey, blockHeight, txIndex)` via the precompile. Re-submission
  reverts.
- **Note:** the mark is set before verification by design - if verification
  fails the whole call (and the mark) rolls back, so a failed submit can never
  poison a future one.

### T-C1 Escrow created for an unattested counterparty
- **Impact:** attacker locks CTC but names a provider/agent that was never
  verified on the source chain, then collects on a fake settlement.
- **Blocked by:** `SettlementEngine.settle` requires
  `escrowPayer(orderId) == verifiedAgentOf(orderId)` and
  `escrowProvider(orderId) == verifiedProviderOf(orderId)`
  (hardening G2, `EscrowPartyMismatch`). A permissionless `createEscrow` cannot
  divert a settlement to an unattested identity.
- **Residual:** none for the identity mismatch case.

### T-C2 Attacker spends more than the mandate allows
- **Impact:** budget drain.
- **Blocked by:** `MandateManager.isMandateValid` (Active, not expired,
  `allowedService` match, `remainingBudget >= amount`) and
  `recordSpend` (only the settlement engine, re-checks every condition, reverts
  `BudgetExceeded` / `MandateExpired` / `MandateNotActive`).

### T-C3 Re-entrancy on escrow transfer
- **Blocked by:** `EscrowManager.release` / `refund` use
  `ReentrancyGuardLite` and do all state transitions before the external
  `provider.call` / `payer.call`.

### T-C4 Operator abuse (settlement operator settles/refunds arbitrarily)
- **Impact:** the operator is a single point of authority on Creditcoin.
- **Mitigated by:** `settle` still has to pass every ASC + mandate + identity
  gate; the operator cannot settle an order that is not genuinely verified.
- **Residual (by design):** the operator is the designated settler - a
  compromised operator key is an authority compromise, not a protocol bypass.
  This is the roadmap's threshold/multisig area.

### T-A1 Agent is prompted to do something outside its mandate
- **Blocked by:** the planner + tool gates in `services/procurement`:
  `checkMandate`, `checkBudget`, `checkReputation`, and the hard refusal path
  when a tool is disallowed (see `AGENT.md`). Refusals stop the flow and flash
  in the UI.
- **Residual:** LLM-based planning is a soft decision layer; the deterministic
  planner is the hard floor. The refusal behavior is tested.

### T-A2 Agent's private key / signing key is stolen
- **Impact:** attacker can sign `VeilPayment`s as the agent.
- **Mitigated by:** every payment is checked against the recorded mandate
  (allowedService, budget) at payment time and again at settlement.
- **Residual:** a stolen key is an identity compromise - budget caps limit the
  blast radius but do not eliminate it. (Roadmap: agent key rotation.)

### T-V1 Audit vault discloses secrets to an unauthorized party
- **Blocked by:** the vault records each transaction with sensitive fields
  **sealed** (AES-256-GCM). Public API routes return only non-sensitive fields
  and never decrypt. Selective disclosure requires a valid EIP-712 `AuditAccess`
  signed by an **authorized auditor** (registry + nonce replay guard) -
  see `PRIVACY_MODEL.md`.
- **Residual:** disclosure authorization grants access to the *sealed* fields
  it names; a dishonest authorized auditor is a trust compromise by definition.

### T-V2 Vault master key leak
- **Blocked by:** `loadVaultKey()` resolves `VEIL_VAULT_KEY` (64 hex) then
  `VEIL_VAULT_KEY_FILE`; demo mode uses an **ephemeral** in-process key
  (non-durable, resets on restart). No key is logged.
- **Residual:** in demo mode the key is in memory only; there is no durable KMS
  integration yet (roadmap).

### T-O1 Unauthorized settle/refund via provider HTTP API
- **Blocked by:** `/api/settle/:id` and `/api/refund/:id` require the
  `x-operator` header matching the configured operator address. This is a demo
  convention, not real auth - documented as such in the README trust model.
- **Residual:** running the service exposed on a network with the default
  operator would let anyone settle. Localhost-only is the supported posture.

### T-O2 Provider HTTP forgery (x402 rail)
- **Blocked by:** the provider verifies the EIP-712 `VeilPayment` signature via
  ECRECOVER, matches it against the recorded `AgentPayment`, and serves the
  paid content only after both hold (see `ARCHITECTURE.md` 3.1).
- **Residual:** `veil-exact` is a vendor adapter scheme (documented honesty
  boundary); real `exact`/EIP-3009 settlement is not claimed.

### T-D1 Destructive demo endpoints reachable by anyone
- **Blocked by:** kill / audit-authorize / audit-revoke require
  `x-veil-admin: <token>` **when `VEIL_ADMIN_TOKEN` is set**; public routes are
  read-only or non-destructive. Default demo mode (no token) is for localhost
  only.
- **Residual:** if you run without `VEIL_ADMIN_TOKEN` on a network, the kill
  switch and vault authorization become open. Set the token.

---

## 3. Applied hardening (G1-G6) - map to threats

| # | Hardening | Threat closed |
|---|---|---|
| G1 | `VeilSource.recordFulfillment` requires `msg.sender == orderProvider` | T-P2 (forged fulfillment) |
| G2 | `SettlementEngine.settle` requires escrow payer/provider == ASC-verified agent/provider | T-C1 (unattested counterparty) |
| G3 | `.gitignore` covers `.next/`, `.env.local`, `*.tsbuildinfo`, `coverage/` | key/secret leakage via VCS |
| G4 | demo auditor authorized once at startup with explicit scope, not per-disclosure | T-V1 (scope creep / re-auth bypass) |
| G5 | kill / audit-authorize / audit-revoke gated by `VEIL_ADMIN_TOKEN` | T-D1 (open destructive endpoints) |
| G6 | `AttestationReceiver.execute` documents safe `processedQueries` ordering | T-P3 (replay) |

---

## 4. Residual risks (honest, by design)

1. **Settlement operator is a single authority** on Creditcoin (C4). Roadmap:
   threshold/multisig operator.
2. **Reputation (>= 3 eligibility) is a discovery-layer rule**, enforced in the
   procurement mirror and the UI agent gate, **not** inside
   `SettlementEngine`. On-chain settlement enforces mandate validity, budget,
   service match, and verified payment/fulfillment/party facts.
3. **Agent signing key theft** has bounded blast radius (budget caps) but is not
   eliminated.
4. **`x-operator` and `x-veil-admin` are demo conventions**, not real auth.
5. **Vault master key has no durable KMS** in demo mode (ephemeral in-memory).
6. **LLM-planned steps are a soft layer**; the deterministic planner is the hard
   floor and is what the tests exercise.

---

## 5. What is NOT claimed

- No claim that `veil-exact` is official x402 (it is a documented vendor
  adapter).
- No claim that Attestcoin is made private by the vault (vault protects VEIL
  data at rest, not on-chain facts).
- No claim of real x402/EIP-3009 on-chain USDC settlement in the demo.
- No claim that demo state is durable (in-memory, resets on restart).
