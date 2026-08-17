# VEIL — Phase 7: Privacy & Audit Layer

> **Attestcoin verifies cross-chain facts. VEIL controls disclosure.**
> Attestcoin does **NOT** provide privacy. VEIL's audit vault seals sensitive
> metadata with authenticated encryption (AES-256-GCM) and reveals it only to
> authorized auditors. Do not claim otherwise.

```
Attestcoin (Creditcoin/ASC)           VEIL audit vault
  └─ verifies the FACT                 └─ controls WHO may see the DETAILS
       payment/fulfillment/settlement        ├─ public view   (commitment + statuses)
       (nothing private)                     ├─ encrypted at rest (AES-256-GCM)
                                             └─ auditor view  (signed + authorized)
```

## 1. What each view exposes

### Public transaction view (anyone — never decrypts)
`GET /api/audit/tx/:txId` and `GET /api/audit/txs`

- `txId`
- `commitment` — binds the public statuses **and** the sealed ciphertext, so the
  record is tamper-evident and on-chain-verifiable
- `verificationStatus`
- `policyStatus`
- `settlementStatus`
- `encrypted: true`

The public endpoints ignore credentials by design: even an authorized auditor
only ever gets the public view from them.

### Auditor view (EIP-712 signed + vault-authorized)
`GET /api/audit/disclosure/:txId?fields=…` and `GET /api/audit/evidence/:txId`

- `agent`, `provider`
- `amountAtoms` (+ `amountUsd` whole-dollar display string)
- `authorization` (mandateId, mandateOwner, serviceId, expiresAt)
- `paymentEvidence`, `fulfillmentEvidence` (resultHash)
- `attestationEvidence` (attestationId — note says it verifies the fact, not privacy)
- `settlementEvidence` (escrowStatus, settlementRef)

## 2. Encryption/decryption flow

`services/audit/crypto.ts`:

1. **Key hierarchy** — a master vault key (32 bytes) never hardcoded, resolved:
   1. env `VEIL_VAULT_KEY` (64 hex chars)
   2. env `VEIL_VAULT_KEY_FILE` (path to a hex key file — keeps the secret out
      of git; `.gitignore` excludes `.vault-key`)
   3. ephemeral random key (demo/tests only, logged as `ephemeral`)
2. A **per-transaction data key** is derived with HKDF-SHA256
   `HKDF(master, info = txId)` — leaking one tx key does not compromise others.
3. The sensitive payload is sealed with **AES-256-GCM** (random 12-byte IV,
   16-byte auth tag). At rest the record is `{ iv, tag, ct }` base64 — no
   plaintext of agent/provider/amount/evidence survives.
4. Decryption happens **only** in `AuditVault.disclose()` / `evidenceBundle()`
   after the vault re-checks authorization. Tampering with `ct`/`tag`/`iv`
   throws (auth tag failure) — corrupted records can never be silently
   disclosed.

## 3. Auditor authorization & selective disclosure

`services/audit/vault.ts` + `services/audit/signer.ts`:

- Operator (via `x-operator` header) grants/revokes an auditor:
  `POST /api/audit/authorize`, `POST /api/audit/revoke`. Grants are optionally
  scoped (`'all'` or a txId allow-list).
- The auditor proves identity with an **EIP-712 `AuditAccess`** signature over
  `(resource, txId, nonce, expiresAt)`, ECRECOVER-verified by the server. A
  header address alone is never trusted.
- The vault enforces three gates:
  1. signer recovered = claimed auditor,
  2. nonlinear — **nonce replay-guarded** (`useNonce`),
  3. authorization — `isAuthorized(auditor, txId)` (not revoked, in scope).
- **Selective disclosure**: `?fields=agent,amountUsd,authorization` returns
  exactly those fields; the auditor (and the public UI) never receives the rest.

## 4. Evidence bundle

`GET /api/audit/evidence/:txId` returns the four evidence entries for an
authorized auditor:

`payment` · `fulfillment` · `attestation` · `settlement`

The attestation entry explicitly carries `note: "...does not grant privacy"`.

## 5. Endpoints

| endpoint | who | exposes |
|----------|-----|---------|
| `GET /api/audit/txs`, `GET /api/audit/tx/:txId` | public | public view only |
| `GET /api/audit/disclosure/:txId?fields=…` | auditor (signed) | subset/full private data |
| `GET /api/audit/evidence/:txId` | auditor (signed) | evidence bundle |
| `POST /api/audit/vault` | operator | record a transaction (sealed at rest) |
| `POST /api/audit/authorize` | operator | grant auditor access |
| `POST /api/audit/revoke` | operator | revoke auditor access |
| `GET /api/audit/health` | public | key source + tx count |

## 6. Tests (`services/audit/audit.test.ts`) — `npm run test:audit`

1. **unauthorized auditor** — valid signature but no grant → 403; public view
   leaks nothing.
2. **authorized auditor** — operator grant → full disclosure matches what was
   recorded.
3. **encrypted metadata** — no plaintext at rest; single-byte tamper is
   detected by the AES-GCM auth tag; public view has no private fields.
4. **successful disclosure** — selective `fields` subset + all four evidence
   entries.
5. **revoked authorization** — revoke stops disclosure/evidence; nonce replay
   denied; public view unaffected.

The test vault key is an in-test fixture buffer (not a shipped secret).

## 7. Demo — `npm run demo:audit`

Records a transaction, renders the public UI (no private fields), denies an
unauthorized auditor, lets an authorized auditor pull a field subset and the
evidence bundle, then revokes and shows disclosure stops while the public view
remains up. Always prints the boundary line: *Attestcoin verifies; VEIL
discloses; privacy is VEIL-side.*