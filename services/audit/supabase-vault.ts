import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { keccak256, solidityPackedKeccak256 } from 'ethers';

import { openSealedBox, seal } from './crypto';
import { publicView } from './vault';
import { VaultBackend } from './vault-interface';
import { AuditorAccount, DisclosureOptions, EvidenceBundle, ProtectedData, PublicTxView, SealedBox, TransactionInput, TransactionRecord } from './types';

type VaultTransactionRow = {
  tx_id: string;
  commitment: string;
  verification_status: string;
  policy_status: string;
  settlement_status: string;
  created_at: number;
  protected_iv: string;
  protected_tag: string;
  protected_ct: string;
  source_tx: string | null;
  attestation_status: 'mirror' | 'proving' | 'verified' | 'a2a-delegation';
  attestation_tx: string | null;
  settlement_tx: string | null;
  escrow_tx: string | null;
  mandate_id: string | null;
  zk_proof_hash: string | null;
  zk_receipt_status: 'none' | 'proving' | 'verified' | null;
};

type AuditorRow = {
  auditor: string;
  authorized: boolean;
  scope: 'all' | string[];
  authorized_at: number;
  revoked_at: number | null;
};

export class SupabaseVault implements VaultBackend {
  private readonly supabase: SupabaseClient;
  private readonly masterKey: Buffer;
  private readonly keySource: string;

  constructor(masterKey: Buffer, keySource = 'provided', opts: { url?: string; serviceKey?: string } = {}) {
    const url = opts.url ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = opts.serviceKey ?? process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
    this.supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    this.masterKey = masterKey;
    this.keySource = keySource;
  }

  private migratedZk = false;

  async recordTransaction(input: TransactionInput): Promise<{ record: TransactionRecord; view: PublicTxView }> {
    const createdAt = input.createdAt ?? Math.floor(Date.now() / 1000);
    const txId = input.txId ?? `veil-${createdAt}`;
    const commitmentSource = input.commitment ?? solidityPackedKeccak256(
      ['string', 'string', 'string', 'uint256'],
      [input.verificationStatus, input.policyStatus, input.settlementStatus, createdAt],
    );
    const box = seal(this.masterKey, txId, JSON.stringify(input.protectedData));
    const ct = Buffer.from(box.ct, 'base64');
    const commitment = solidityPackedKeccak256(['bytes32', 'bytes', 'bytes32'], [keccak256(ct), ct, commitmentSource]);
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
    let row = recordToRow(record);
    let { error } = await this.supabase.from('vault_transactions').upsert(row);
    if (error && !this.migratedZk && (error.message?.includes('zk_proof_hash') || error.message?.includes('zk_receipt_status') || error.message?.includes('column'))) {
      delete row.zk_proof_hash;
      delete row.zk_receipt_status;
      ({ error } = await this.supabase.from('vault_transactions').upsert(row));
      this.migratedZk = true;
    }
    if (error) throw new Error(error.message);
    return { record, view: publicView(record) };
  }

  async attachAttestation(txId: string, opts: { attestationStatus: 'proving' | 'verified'; attestationTx?: string; sourceTx?: string; zkReceiptStatus?: 'none' | 'proving' | 'verified' }): Promise<{ ok: boolean; error?: string }> {
    const patch: Record<string, unknown> = { attestation_status: opts.attestationStatus, updated_at: Math.floor(Date.now() / 1000) };
    if (opts.attestationTx) patch.attestation_tx = opts.attestationTx;
    if (opts.sourceTx) patch.source_tx = opts.sourceTx;
    if (opts.zkReceiptStatus && !this.migratedZk) patch.zk_receipt_status = opts.zkReceiptStatus;
    let result = await this.updateKnown(txId, patch);
    if (!result.ok && opts.zkReceiptStatus && !this.migratedZk && result.error?.includes('column')) {
      delete patch.zk_receipt_status;
      this.migratedZk = true;
      result = await this.updateKnown(txId, patch);
    }
    return result;
  }

  async attachSettlement(txId: string, opts: { settlementStatus?: string; settlementTx?: string; escrowTx?: string; mandateId?: string }): Promise<{ ok: boolean; error?: string }> {
    const patch: Record<string, unknown> = { updated_at: Math.floor(Date.now() / 1000) };
    if (opts.settlementStatus) patch.settlement_status = opts.settlementStatus;
    if (opts.settlementTx) patch.settlement_tx = opts.settlementTx;
    if (opts.escrowTx) patch.escrow_tx = opts.escrowTx;
    if (opts.mandateId) patch.mandate_id = opts.mandateId;
    return this.updateKnown(txId, patch);
  }

  async get(txId: string): Promise<TransactionRecord | undefined> {
    const { data, error } = await this.supabase.from('vault_transactions').select('*').eq('tx_id', txId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToRecord(data as VaultTransactionRow) : undefined;
  }

  async list(): Promise<PublicTxView[]> {
    const { data, error } = await this.supabase.from('vault_transactions').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as VaultTransactionRow[]).map((row) => publicView(rowToRecord(row)));
  }

  async publicView(txId: string): Promise<PublicTxView | undefined> {
    const rec = await this.get(txId);
    return rec ? publicView(rec) : undefined;
  }

  get keySourceLabel(): string {
    return this.keySource;
  }

  async txCount(): Promise<number> {
    const { count, error } = await this.supabase.from('vault_transactions').select('tx_id', { count: 'exact', head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async authorize(auditor: string, opts: { scope?: 'all' | string[] } = {}): Promise<AuditorAccount> {
    const key = auditor.toLowerCase();
    const existing = await this.auditorOf(key);
    const account: AuditorAccount = existing
      ? { ...existing, authorized: true, scope: opts.scope ?? existing.scope ?? 'all', revokedAt: undefined }
      : { auditor: key, authorized: true, scope: opts.scope ?? 'all', authorizedAt: Math.floor(Date.now() / 1000) };
    const { error } = await this.supabase.from('vault_auditors').upsert(auditorToRow(account));
    if (error) throw new Error(error.message);
    return account;
  }

  async revoke(auditor: string): Promise<AuditorAccount | undefined> {
    const account = await this.auditorOf(auditor);
    if (!account) return undefined;
    const updated = { ...account, authorized: false, revokedAt: Math.floor(Date.now() / 1000) };
    const { error } = await this.supabase.from('vault_auditors').update(auditorToRow(updated)).eq('auditor', updated.auditor);
    if (error) throw new Error(error.message);
    return updated;
  }

  async auditorOf(auditor: string): Promise<AuditorAccount | undefined> {
    const { data, error } = await this.supabase.from('vault_auditors').select('*').eq('auditor', auditor.toLowerCase()).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToAuditor(data as AuditorRow) : undefined;
  }

  async auditorsList(): Promise<AuditorAccount[]> {
    const { data, error } = await this.supabase.from('vault_auditors').select('*').order('authorized_at', { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as AuditorRow[]).map(rowToAuditor);
  }

  async isAuthorized(auditor: string, txId?: string): Promise<boolean> {
    const account = await this.auditorOf(auditor);
    if (!account || !account.authorized || account.revokedAt !== undefined) return false;
    if (account.scope === 'all') return true;
    return txId !== undefined && account.scope.includes(txId);
  }

  async useNonce(auditor: string, nonce: string): Promise<boolean> {
    const key = `${auditor.toLowerCase()}:${nonce}`;
    const { error } = await this.supabase.from('vault_used_nonces').insert({ key, used_at: Math.floor(Date.now() / 1000) });
    if (!error) return true;
    if (error.code === '23505') return false;
    throw new Error(error.message);
  }

  async disclose(txId: string, auditor: string, opts: DisclosureOptions = {}): Promise<ProtectedData | undefined> {
    const rec = await this.get(txId);
    if (!rec) return undefined;
    if (!(await this.isAuthorized(auditor, txId))) return undefined;
    const data = JSON.parse(openSealedBox(this.masterKey, txId, rec.protected)) as ProtectedData;
    const fields = opts.fields?.filter((f) => f.trim().length > 0);
    if (!fields?.length) return data;
    const subset: Record<string, unknown> = {};
    for (const f of fields) subset[f] = f in data ? (data as unknown as Record<string, unknown>)[f] : undefined;
    return subset as unknown as ProtectedData;
  }

  async evidenceBundle(txId: string, auditor: string): Promise<EvidenceBundle | undefined> {
    const found = await this.disclose(txId, auditor);
    return found ? { payment: found.paymentEvidence, fulfillment: found.fulfillmentEvidence, attestation: found.attestationEvidence, settlement: found.settlementEvidence } : undefined;
  }

  private async updateKnown(txId: string, patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    if (!(await this.get(txId))) return { ok: false, error: 'TransactionNotKnown' };
    const { error } = await this.supabase.from('vault_transactions').update(patch).eq('tx_id', txId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }
}

function recordToRow(rec: TransactionRecord) {
  const row: Record<string, unknown> = {
    tx_id: rec.txId,
    commitment: rec.commitment,
    verification_status: rec.verificationStatus,
    policy_status: rec.policyStatus,
    settlement_status: rec.settlementStatus,
    created_at: rec.createdAt,
    protected_iv: rec.protected.iv,
    protected_tag: rec.protected.tag,
    protected_ct: rec.protected.ct,
    source_tx: rec.sourceTx ?? null,
    attestation_status: rec.attestationStatus,
    attestation_tx: rec.attestationTx ?? null,
    settlement_tx: rec.settlementTx ?? null,
    escrow_tx: rec.escrowTx ?? null,
    mandate_id: rec.mandateId ?? null,
    updated_at: Math.floor(Date.now() / 1000),
  };
  if (rec.zkProofHash) row.zk_proof_hash = rec.zkProofHash;
  if (rec.zkReceiptStatus) row.zk_receipt_status = rec.zkReceiptStatus;
  return row;
}

function rowToRecord(row: VaultTransactionRow): TransactionRecord {
  const box: SealedBox = { alg: 'AES-256-GCM', iv: row.protected_iv, tag: row.protected_tag, ct: row.protected_ct };
  return {
    txId: row.tx_id,
    commitment: row.commitment,
    verificationStatus: row.verification_status,
    policyStatus: row.policy_status,
    settlementStatus: row.settlement_status,
    createdAt: Number(row.created_at),
    protected: box,
    sourceTx: row.source_tx ?? undefined,
    attestationStatus: row.attestation_status,
    attestationTx: row.attestation_tx ?? undefined,
    settlementTx: row.settlement_tx ?? undefined,
    escrowTx: row.escrow_tx ?? undefined,
    mandateId: row.mandate_id ?? undefined,
    zkProofHash: (row as Record<string, unknown>).zk_proof_hash as string ?? undefined,
    zkReceiptStatus: (row as Record<string, unknown>).zk_receipt_status as 'none' | 'proving' | 'verified' ?? undefined,
  };
}

function auditorToRow(account: AuditorAccount) {
  return {
    auditor: account.auditor,
    authorized: account.authorized,
    scope: account.scope,
    authorized_at: account.authorizedAt,
    revoked_at: account.revokedAt ?? null,
  };
}

function rowToAuditor(row: AuditorRow): AuditorAccount {
  return {
    auditor: row.auditor,
    authorized: row.authorized,
    scope: row.scope,
    authorizedAt: Number(row.authorized_at),
    revokedAt: row.revoked_at === null ? undefined : Number(row.revoked_at),
  };
}
