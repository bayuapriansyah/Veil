# VEIL - Privacy Model

This document describes precisely what VEIL keeps private, what is public, and
who may see what. It maps to the real `AuditVault` implementation
(`services/audit/`) - no aspirational privacy claims.

Companion docs: `THREAT_MODEL.md` (T-V1/T-V2), `ARCHITECTURE.md` (audit service
routes), `AGENT.md` (what the agent records).

---

## 1. Scope and honest boundary

- The vault protects **VEIL's own data at rest** (transactions recorded by the
  console/demo) and controls **who** may read the sensitive fields.
- It does **not** make Attestcoin private: cross-chain verification on
  Creditcoin reads source-chain facts. VEIL controls *disclosure of VEIL's
  ledger*, not the public chain data.
- Demo vault state is **in-memory**: records, auditor registry, and used nonces
  reset on server restart.

---

## 2. What is public vs sealed

Every recorded transaction (`AuditVault.recordTransaction`) produces:

**Public view** (`PUBLIC_FIELDS`) - served by public routes, never decrypted:

| Field | Meaning |
|---|---|
| `txId` | transaction id (derived from the commitment) |
| `commitment` | binds public facts + sealed ciphertext (see below) |
| `verificationStatus` | payment/fulfillment verification state |
| `policyStatus` | mandate/policy compliance state |
| `settlementStatus` | settlement state |
| `createdAt` | timestamp |
| `encrypted: true` | marker that sensitive fields are sealed |

**Sealed** (`protected`, AES-256-GCM): agent, provider, amount, authorization,
and the payment/fulfillment/attestation/settlement evidence. No version of the
stored record contains plaintext of those fields.

### The commitment

```text
commitment = keccak256(keccak256(ciphertext) || ciphertext || commitmentSource)
```

`commitmentSource` binds the public statuses + timestamp. Because the ciphertext
is part of the hash, tampering with either the public view or the sealed box
breaks the commitment. `openSealedBox` also throws on a GCM auth-tag mismatch,
so a corrupted record can never be silently disclosed.

---

## 3. Key hierarchy

Master key resolution (`loadVaultKey`, in order, no silent fallback to a secret):

| # | Source | Detail |
|---|---|---|
| 1 | `VEIL_VAULT_KEY` env | 64 hex chars -> 32 bytes; invalid value **throws** |
| 2 | `VEIL_VAULT_KEY_FILE` env | path to a file whose first line is the 64-hex key |
| 3 | ephemeral | random 32 bytes in-process; **demo/tests only**, lost on restart |

Per-transaction data key: `HKDF-SHA256(masterKey, info = txId)` - each record is
encrypted under its own derived key, so a leaked per-tx key does not expose the
rest of the vault. The key source is surfaced as `keySource` in the UI
(`env` / `file` / `ephemeral`).

---

## 4. Selective disclosure - who may see what

### 4.1 Auditor registry (the vault decides)

The vault keeps an auditor registry: `authorize(auditor, { scope })` grants
access with scope `'all'` or a txId allow-list; `revoke(auditor)` removes it.
`isAuthorized(auditor, txId)` returns true only if the account exists, is
`authorized`, is **not** revoked, and the txId is in scope.

### 4.2 Signed access requests (EIP-712)

The demo auditor does not just present an address. It signs an EIP-712
`AuditAccess` typed data over the VEIL Audit Registers domain
(chainId 11155111 = Sepolia):

```text
AuditAccess(string resource, bytes32 txId, uint256 nonce, uint256 expiresAt)
```

`verifyAuditAccess` enforces, in order:

1. signature ECRECOVERs to the claimed auditor,
2. `resource` exactly matches the endpoint path,
3. `txId` exactly matches the requested transaction,
4. `expiresAt` not in the past (default TTL 5 minutes),
5. the recovered signer is authorized **in the vault** (authentication here,
   authority there).

### 4.3 Nonce replay guard

The vault records every used nonce (`auditor:nonce`). Reusing a signed request
is rejected - a captured disclosure cannot be replayed against another
transaction or later in time.

### 4.4 Field subsets

`disclose(txId, auditor, { fields })` returns **only** the requested fields from
the protected payload; `evidenceBundle(txId, auditor)` returns the
payment/fulfillment/attestation/settlement evidence group. Both re-check
authorization inside the vault (the server's ECRECOVER pass is authentication;
authority lives in the vault).

---

## 5. API routes and their privacy posture

| Route | Posture |
|---|---|
| `/api/audit/txs`, `/api/audit/tx/:txId` | public view only - never decrypts |
| `/api/audit/disclosure/:txId?fields=...` | signed + authorized selective disclosure |
| `/api/audit/evidence/:txId` | signed + authorized evidence bundle |
| `/api/audit/vault` | operator-only record (sealed at rest) |
| `/api/audit/authorize`, `/api/audit/revoke` | operator-only registry changes |
| `/api/audit/health` | key source + tx count |

The frontend `/api/veil/audit/attempt` route deliberately runs an
**unauthorized** auditor against the disclosure endpoint to prove the gate
rejects it (covered by the audit test suite).

---

## 6. Crypto primitives used

| Primitive | Where | Notes |
|---|---|---|
| AES-256-GCM | seal/open each transaction | authenticated; tamper -> BadTag throw |
| HKDF-SHA256 | per-tx data key derivation | info = txId, 32-byte salt |
| EIP-712 typed data | `AuditAccess` requests | domain = VEIL Audit Registers |
| ECRECOVER | auditor authentication | recovered signer must match claim |
| keccak256 | commitment + txId derivation | binds ciphertext + public facts |

All from `node:crypto` and `ethers` - no custom crypto.

---

## 7. Privacy guarantee, stated precisely

1. A reader of public routes learns the statuses, the timestamp, and the
   **commitment** (a hash) of each transaction - and nothing of the sealed
   fields.
2. A reader of the audit service without a valid signed `AuditAccess` cannot
   decrypt anything.
3. A validly signed auditor can only decrypt what the **vault** authorizes for
   its account scope, and only before the request expires (5-min default).
4. Replaying a captured request fails (nonce + resource + txId binding).
5. Tampering with a stored record is detected (GCM tag + commitment).
6. Master key compromise requires one of: the `VEIL_VAULT_KEY` env value, the
   `VEIL_VAULT_KEY_FILE` contents, or memory access to the running demo process.

---

## 8. Not claimed

- No claim that on-chain Attestcoin facts are private (they are cross-chain
  proofs by design).
- No claim of durable vault storage or a KMS in the demo (roadmap).
- No claim that an authorized auditor cannot leak what it legitimately
  decrypts - authorization is a capability, not a confidentiality promise
  against the holder.
