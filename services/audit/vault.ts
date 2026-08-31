import { randomBytes } from 'node:crypto';
import { keccak256, solidityPackedKeccak256, toUtf8Bytes } from 'ethers';

import { openSealedBox, seal } from './crypto';
import {
  AuditorAccount,
  DisclosureOptions,
  EvidenceBundle,
  ProtectedData,
  PublicTxView,
  SettlementPreimage,
  TransactionInput,
  TransactionRecord,
} from './types';
import { VaultBackend } from './vault-interface';

const SERVICE_LABELS: Record<string, string> = {
  '0xb4a22cf5ba542b9c3cdc7ffac0e910eb54204424b9b6d92d7888a79afadd09c9': 'Market Data',
};

export function resolveServiceLabel(serviceId: string): string {
  return SERVICE_LABELS[serviceId] ?? 'Data Service';
}

export function atomsToUsd(atoms: string | bigint): string {
  const n = Number(BigInt(atoms)) / 1e18;
  return n.toFixed(3);
}

const PUBLIC_FIELDS = ['txId', 'commitment', 'verificationStatus', 'policyStatus', 'settlementStatus', 'createdAt'] as const;

export class AuditVault implements VaultBackend {
  private transactions = new Map<string, TransactionRecord>();
  private auditors = new Map<string, AuditorAccount>();
  private usedNonces = new Set<string>();
  private readonly masterKey: Buffer;
  private readonly keySource: string;

  constructor(masterKey: Buffer, keySource = 'provided') {
    this.masterKey = masterKey;
    this.keySource = keySource;
  }

  async recordTransaction(input: TransactionInput): Promise<{ record: TransactionRecord; view: PublicTxView }> {
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
      zkProofHash: input.zkProofHash,
      zkReceiptStatus: input.zkReceiptStatus,
    };
    this.transactions.set(txId, record);
    return { record, view: publicView(record) };
  }

  async attachAttestation(txId: string, opts: { attestationStatus: 'proving' | 'verified'; attestationTx?: string; sourceTx?: string; zkReceiptStatus?: 'none' | 'proving' | 'verified' }): Promise<{ ok: boolean; error?: string }> {
    const rec = this.transactions.get(txId);
    if (!rec) return { ok: false, error: 'TransactionNotKnown' };
    rec.attestationStatus = opts.attestationStatus;
    if (opts.attestationTx) rec.attestationTx = opts.attestationTx;
    if (opts.sourceTx) rec.sourceTx = opts.sourceTx;
    if (opts.zkReceiptStatus) rec.zkReceiptStatus = opts.zkReceiptStatus;
    return { ok: true };
  }

  async attachSettlement(txId: string, opts: { settlementStatus?: string; settlementTx?: string; escrowTx?: string; mandateId?: string }): Promise<{ ok: boolean; error?: string }> {
    const rec = this.transactions.get(txId);
    if (!rec) return { ok: false, error: 'TransactionNotKnown' };
    if (opts.settlementStatus) rec.settlementStatus = opts.settlementStatus;
    if (opts.settlementTx) rec.settlementTx = opts.settlementTx;
    if (opts.escrowTx) rec.escrowTx = opts.escrowTx;
    if (opts.mandateId) rec.mandateId = opts.mandateId;
    return { ok: true };
  }

  async get(txId: string): Promise<TransactionRecord | undefined> {
    return this.transactions.get(txId);
  }

  async list(): Promise<PublicTxView[]> {
    return [...this.transactions.values()].map((rec) => publicView(rec, this.masterKey));
  }

  async publicView(txId: string): Promise<PublicTxView | undefined> {
    const rec = this.transactions.get(txId);
    return rec ? publicView(rec, this.masterKey) : undefined;
  }

  async settlementPreimage(txId: string): Promise<SettlementPreimage | undefined> {
    const rec = this.transactions.get(txId);
    if (!rec) return undefined;
    const plaintext = openSealedBox(this.masterKey, txId, rec.protected);
    const data = JSON.parse(plaintext) as ProtectedData;
    return {
      salt: data.salt ?? '0x' + '0'.repeat(64),
      provider: data.provider,
      amount: data.amountAtoms,
      serviceId: data.authorization.serviceId,
    };
  }

  get keySourceLabel(): string {
    return this.keySource;
  }

  async txCount(): Promise<number> {
    return this.transactions.size;
  }

  async authorize(auditor: string, opts: { scope?: 'all' | string[] } = {}): Promise<AuditorAccount> {
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

  async revoke(auditor: string): Promise<AuditorAccount | undefined> {
    const key = auditor.toLowerCase();
    const account = this.auditors.get(key);
    if (!account) return undefined;
    account.authorized = false;
    account.revokedAt = Math.floor(Date.now() / 1000);
    return { ...account };
  }

  async auditorOf(auditor: string): Promise<AuditorAccount | undefined> {
    return this.auditors.get(auditor.toLowerCase());
  }

  async auditorsList(): Promise<AuditorAccount[]> {
    return [...this.auditors.values()];
  }

  async isAuthorized(auditor: string, txId?: string): Promise<boolean> {
    const account = this.auditors.get(auditor.toLowerCase());
    if (!account || !account.authorized || account.revokedAt !== undefined) return false;
    if (account.scope === 'all') return true;
    return txId !== undefined && account.scope.includes(txId);
  }

  async useNonce(auditor: string, nonce: string): Promise<boolean> {
    const key = `${auditor.toLowerCase()}:${nonce}`;
    if (this.usedNonces.has(key)) return false;
    this.usedNonces.add(key);
    return true;
  }

  async disclose(txId: string, auditor: string, opts: DisclosureOptions = {}): Promise<ProtectedData | undefined> {
    const rec = this.transactions.get(txId);
    if (!rec) return undefined;
    if (!(await this.isAuthorized(auditor, txId))) return undefined;
    const plaintext = openSealedBox(this.masterKey, txId, rec.protected);
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

  async evidenceBundle(txId: string, auditor: string): Promise<EvidenceBundle | undefined> {
    const found = await this.disclose(txId, auditor);
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

export function publicView(rec: TransactionRecord, masterKey?: Buffer): PublicTxView {
  const base: PublicTxView = {
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
    settlementTx: rec.settlementTx,
    escrowTx: rec.escrowTx,
    mandateId: rec.mandateId,
    zkProofHash: rec.zkProofHash,
    zkReceiptStatus: rec.zkReceiptStatus,
  };

  if (masterKey) {
    try {
      const plaintext = openSealedBox(masterKey, rec.txId, rec.protected);
      const data = JSON.parse(plaintext) as ProtectedData;
      base.provider = data.provider;
      base.amountUsd = data.amountUsd;
      base.serviceLabel = resolveServiceLabel(data.authorization.serviceId);
    } catch (e) { console.error(`[vault] publicView decrypt failed txId=${rec.txId}:`, e instanceof Error ? e.message : e); }
  }

  return base;
}

function deriveTxId(commitment: string): string {
  return '0x' + commitment.replace(/^0x/, '').slice(0, 32);
}

function defaultTxId(): string {
  return '0x' + keccak256(toUtf8Bytes(`veil-tx:${randomBytes(16).toString('hex')}`)).slice(2, 34);
}

export { PUBLIC_FIELDS };
