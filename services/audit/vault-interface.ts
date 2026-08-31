import { AuditorAccount, DisclosureOptions, EvidenceBundle, ProtectedData, PublicTxView, SettlementPreimage, TransactionInput, TransactionRecord } from './types';

export interface VaultBackend {
  recordTransaction(input: TransactionInput): Promise<{ record: TransactionRecord; view: PublicTxView }>;
  attachAttestation(txId: string, opts: { attestationStatus: 'proving' | 'verified'; attestationTx?: string; sourceTx?: string; zkReceiptStatus?: 'none' | 'proving' | 'verified' }): Promise<{ ok: boolean; error?: string }>;
  attachSettlement(txId: string, opts: { settlementStatus?: string; settlementTx?: string; escrowTx?: string; mandateId?: string }): Promise<{ ok: boolean; error?: string }>;
  get(txId: string): Promise<TransactionRecord | undefined>;
  list(): Promise<PublicTxView[]>;
  publicView(txId: string): Promise<PublicTxView | undefined>;
  settlementPreimage(txId: string): Promise<SettlementPreimage | undefined>;
  readonly keySourceLabel: string;
  txCount(): Promise<number>;
  authorize(auditor: string, opts?: { scope?: 'all' | string[] }): Promise<AuditorAccount>;
  revoke(auditor: string): Promise<AuditorAccount | undefined>;
  auditorOf(auditor: string): Promise<AuditorAccount | undefined>;
  auditorsList(): Promise<AuditorAccount[]>;
  isAuthorized(auditor: string, txId?: string): Promise<boolean>;
  useNonce(auditor: string, nonce: string): Promise<boolean>;
  disclose(txId: string, auditor: string, opts?: DisclosureOptions): Promise<ProtectedData | undefined>;
  evidenceBundle(txId: string, auditor: string): Promise<EvidenceBundle | undefined>;
}
