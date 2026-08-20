/**
 * AuditVault — VEIL's privacy + audit authority.
 *
 * Responsibilities:
 *  - Store each transaction's PUBLIC facts and a binding COMMITMENT.
 *  - Seal the SENSITIVE metadata (agent, provider, amount, authorization,
 *    payment/fulfillment/attestation/settlement evidence) with AES-256-GCM at
 *    rest. No version of the stored record contains plaintext of those fields.
 *  - Keep the auditor registry (authorize / revoke). The vault decides whether
 *    a given auditor may see a given transaction ("selective disclosure").
 *  - Produce auditor views (full or field-subset) and the EVIDENCE BUNDLE.
 *  - Replay-guard auditor nonces.
 *
 * Boundary: the vault protects VEIL data at rest and controls WHO may see it.
 * It does not make Attestcoin private — attestation verifies cross-chain facts.
 */
import { randomBytes } from 'node:crypto';
import { keccak256, solidityPackedKeccak256, toUtf8Bytes } from 'ethers';

import { openSealedBox, seal } from './crypto';
import {
  AuditorAccount,
  DisclosureOptions,
  EvidenceBundle,
  ProtectedData,
  PublicTxView,
  TransactionInput,
  TransactionRecord,
} from './types';

const PUBLIC_FIELDS = ['txId', 'commitment', 'verificationStatus', 'policyStatus', 'settlementStatus', 'createdAt'] as const;

export class AuditVault {
  private transactions = new Map<string, TransactionRecord>();
  private auditors = new Map<string, AuditorAccount>();
  private usedNonces = new Set<string>();
  private readonly masterKey: Buffer;
  private readonly keySource: string;

  constructor(masterKey: Buffer, keySource = 'provided') {
    this.masterKey = masterKey;
    this.keySource = keySource;
  }

  // --- recording ---------------------------------------------------------- //

recordTransaction(input: TransactionInput): { record: TransactionRecord; view: PublicTxView } {
    const createdAt = input.createdAt ?? Math.floor(Date.now() / 1000);
    const txId = input.txId ?? deriveTxId(input.commitment ?? defaultTxId());
    const commitmentSource =
      input.commitment ??
      solidityPackedKeccak256(
        ['string', 'string', 'string', 'uint256'],
        [input.verificationStatus, input.policyStatus, input.settlementStatus, createdAt],
      );

    const plaintext = JSON.stringify(input.protectedData);
    const box = seal(this.masterKey, txId, plaintext);
    const ct = Buffer.from(box.ct, 'base64');
    // The commitment binds the public facts AND the sealed ciphertext.
    const commitment = solidityPackedKeccak256(
      ['bytes32', 'bytes', 'bytes32'],
      [keccak256(ct), ct, commitmentSource],
    );

    const record: TransactionRecord = {
      txId,
      commitment,
      verificationStatus: input.verificationStatus,
      policyStatus: input.policyStatus,
      settlementStatus: input.settlementStatus,
      createdAt,
      protected: box,
      sourceTx: input.sourceTx,
      attestationStatus: input.attestationStatus ?? 'mirror',
      attestationTx: input.attestationTx,
    };
    this.transactions.set(txId, record);
    return { record, view: publicView(record) };
  }

  /**
   * Attach the live attestation fact to a stored record once the worker has
   * proven the source-chain tx on Creditcoin. Public-only update (tx hashes are
   * public chain data) — the sealed ciphertext and its commitment stay stable.
   */
  attachAttestation(txId: string, opts: { attestationStatus: 'proving' | 'verified'; attestationTx?: string; sourceTx?: string }): { ok: boolean; error?: string } {
    const rec = this.transactions.get(txId);
    if (!rec) return { ok: false, error: 'TransactionNotKnown' };
    rec.attestationStatus = opts.attestationStatus;
    if (opts.attestationTx) rec.attestationTx = opts.attestationTx;
    if (opts.sourceTx) rec.sourceTx = opts.sourceTx;
    return { ok: true };
  }

  // --- public (never decrypts) -------------------------------------------- //

  get(txId: string): TransactionRecord | undefined {
    return this.transactions.get(txId);
  }

  list(): PublicTxView[] {
    return [...this.transactions.values()].map(publicView);
  }

  publicView(txId: string): PublicTxView | undefined {
    const rec = this.transactions.get(txId);
    return rec ? publicView(rec) : undefined;
  }

  get keySourceLabel(): string {
    return this.keySource;
  }

  get txCount(): number {
    return this.transactions.size;
  }

  // --- auditor registry --------------------------------------------------- //

  /** Grant an auditor access (scope 'all' or a txId allow-list). */
  authorize(auditor: string, opts: { scope?: 'all' | string[] } = {}): AuditorAccount {
    const key = auditor.toLowerCase();
    const existing = this.auditors.get(key);
    const account: AuditorAccount = existing
      ? { ...existing, authorized: true, scope: opts.scope ?? existing.scope ?? 'all', revokedAt: undefined }
      : {
        auditor: auditor.toLowerCase(),
        authorized: true,
        scope: opts.scope ?? 'all',
        authorizedAt: Math.floor(Date.now() / 1000),
      };
    this.auditors.set(key, account);
    return account;
  }

  revoke(auditor: string): AuditorAccount | undefined {
    const key = auditor.toLowerCase();
    const account = this.auditors.get(key);
    if (!account) return undefined;
    account.authorized = false;
    account.revokedAt = Math.floor(Date.now() / 1000);
    return { ...account };
  }

  auditorOf(auditor: string): AuditorAccount | undefined {
    return this.auditors.get(auditor.toLowerCase());
  }

  /** The vault's authorization decision: authorized, not revoked, in scope. */
  isAuthorized(auditor: string, txId?: string): boolean {
    const account = this.auditors.get(auditor.toLowerCase());
    if (!account || !account.authorized || account.revokedAt !== undefined) return false;
    if (account.scope === 'all') return true;
    return txId !== undefined && account.scope.includes(txId);
  }

  /** Consume an auditor nonce — returns false on replay. */
  useNonce(auditor: string, nonce: string): boolean {
    const key = `${auditor.toLowerCase()}:${nonce}`;
    if (this.usedNonces.has(key)) return false;
    this.usedNonces.add(key);
    return true;
  }

  // --- auditor views ------------------------------------------------------ //

  /**
   * Selective disclosure. Returns ONLY the requested fields (or the whole
   * protected payload). The vault re-checks authorization — the server's
   * ECRECOVER pass is authentication; authority lives here.
   */
  disclose(txId: string, auditor: string, opts: DisclosureOptions = {}): ProtectedData | undefined {
    const rec = this.transactions.get(txId);
    if (!rec) return undefined;
    if (!this.isAuthorized(auditor, txId)) return undefined;
    const plaintext = openSealedBox(this.masterKey, txId, rec.protected); // throws on tamper
    const data = JSON.parse(plaintext) as ProtectedData;
    const fields = opts.fields?.filter((f) => f.trim().length > 0);
    if (fields && fields.length > 0) {
      const subset: Record<string, unknown> = {};
      for (const f of fields) {
        if (f in data) subset[f] = (data as unknown as Record<string, unknown>)[f];
        else subset[f] = undefined;
      }
      return subset as unknown as ProtectedData;
    }
    return data;
  }

  /** The evidence bundle (payment/fulfillment/attestation/settlement). */
  evidenceBundle(txId: string, auditor: string): EvidenceBundle | undefined {
    const found = this.disclose(txId, auditor);
    if (!found) return undefined;
    const bundle: EvidenceBundle = {
      payment: found.paymentEvidence,
      fulfillment: found.fulfillmentEvidence,
      attestation: found.attestationEvidence,
      settlement: found.settlementEvidence,
    };
    return bundle;
  }
}

function publicView(rec: TransactionRecord): PublicTxView {
  return {
    txId: rec.txId,
    commitment: rec.commitment,
    verificationStatus: rec.verificationStatus,
    policyStatus: rec.policyStatus,
    settlementStatus: rec.settlementStatus,
    createdAt: rec.createdAt,
    encrypted: true,
    sourceTx: rec.sourceTx,
    attestationStatus: rec.attestationStatus,
    attestationTx: rec.attestationTx,
  };
}

function deriveTxId(commitment: string): string {
  return '0x' + commitment.replace(/^0x/, '').slice(0, 32);
}

function defaultTxId(): string {
  return '0x' + keccak256(toUtf8Bytes(`veil-tx:${randomBytes(16).toString('hex')}`)).slice(2, 34);
}

export { PUBLIC_FIELDS };