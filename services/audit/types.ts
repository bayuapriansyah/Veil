/**
 * VEIL Phase 7 — privacy & audit layer types.
 *
 * Boundary that the whole phase enforces:
 *   Attestcoin verifies cross-chain facts (payment/fulfillment/settlement
 *   attested on Creditcoin). VEIL controls disclosure of the sensitive details
 *   (agent, provider, amount, evidence). Attestcoin therefore does NOT provide
 *   privacy; the audit vault's authenticated encryption does.
 *
 * Public view exposes ONLY: txId, commitment, verification status, policy
 * status, settlement status (and the `encrypted` marker). Everything else is
 * sealed with AES-256-GCM and revealed only to authorized auditors.
 *
 * Money amounts are atom strings (BigInt hazards) — whole-dollar display values
 * use number/string so they never hit the BigInt JSON serialization bug.
 */

/** Everything the PUBLIC can see. Never contains decrypted private data. */
export interface PublicTxView {
  txId: string;
  commitment: string;
  verificationStatus: string;
  policyStatus: string;
  settlementStatus: string;
  encrypted: boolean;
  createdAt: number;
  /** Live source-chain AgentPayment tx (public chain data), when recorded on-chain. */
  sourceTx?: string;
  /** Live attestation fact (public chain data): mirror = no on-chain record, proving = worker submitted, verified = proven on Creditcoin, a2a-delegation = A2A delegated. */
  attestationStatus: 'mirror' | 'proving' | 'verified' | 'a2a-delegation';
  /** Creditcoin AttestationReceiver proof-submit tx, once verified. */
  attestationTx?: string;
  /** Live on-chain settlement (SettlementEngine.settle) tx on Creditcoin, once settled. */
  settlementTx?: string;
  /** EscrowManager.createEscrow tx on Creditcoin (the escrow lock). */
  escrowTx?: string;
  /** MandateManager mandate id backing the settlement. */
  mandateId?: string;
  /** Poseidon(2) commitment hash linking the ZK proof to the order. */
  zkProofHash?: string;
  /** ZK receipt verification status on Creditcoin. */
  zkReceiptStatus?: 'none' | 'proving' | 'verified';
  /** Provider address (public on-chain via FulfillmentReceipt). */
  provider?: string;
  /** Dollar amount (derived from atoms, non-sensitive). */
  amountUsd?: string;
  /** Human-readable service label. */
  serviceLabel?: string;
}

/** Evidence collected across the VEIL stack (kept encrypted at rest). */
export interface EvidenceBundle {
  payment: {
    orderId: string;
    paymentVerified: boolean;
    scheme: string;
    recordedAt: number;
  };
  fulfillment: {
    resultHash: string;
    fulfillmentVerified: boolean;
    recordedAt: number;
    /** Live source-chain FulfillmentReceipt tx hash (provider-signed), when recorded. */
    fulfillmentTx?: string;
  };
  attestation: {
    /** Cross-chain reference (Creditcoin ASC / AttestationReceiver, or the source-chain tx). */
    attestationId: string;
    verified: boolean;
    /** Explicit: attestation verifies the fact — it does not grant privacy. */
    note: string;
    /** mirror = no live on-chain record · proving = worker submitted · verified = proven on Creditcoin. */
    stage?: 'mirror' | 'proving' | 'verified';
    recordedAt: number;
  };
  settlement: {
    escrowStatus: string;
    settlementRef: string;
    recordedAt: number;
  };
}

/** The sensitive payload — encrypted at rest with AES-256-GCM. */
export interface ProtectedData {
  agent: string;
  provider: string;
  amountAtoms: string;
  amountUsd: string;
  authorization: {
    mandateId: number;
    mandateOwner: string;
    serviceId: string;
    expiresAt: number;
  };
  paymentEvidence: EvidenceBundle['payment'];
  fulfillmentEvidence: EvidenceBundle['fulfillment'];
  attestationEvidence: EvidenceBundle['attestation'];
  settlementEvidence: EvidenceBundle['settlement'];
  /** Commitment salt — used by operator to verify commitment at settlement time. */
  salt: string;
  /** On-chain commitment hash (keccak256 of provider+amount+serviceId+salt). */
  commitment: string;
}

/** Input to `Vault.recordTransaction`. */
export interface TransactionInput {
  /** Stable public identifier (e.g. the on-chain order id). Default: derived. */
  txId?: string;
  commitment?: string;
  verificationStatus: string;
  policyStatus: string;
  settlementStatus: string;
  protectedData: ProtectedData;
  createdAt?: number;
  /** Live source-chain AgentPayment tx (public chain data). */
  sourceTx?: string;
  /** Live attestation fact; default 'mirror'. */
  attestationStatus?: 'mirror' | 'proving' | 'verified' | 'a2a-delegation';
  /** Creditcoin proof-submit tx once verified (public chain data). */
  attestationTx?: string;
  zkProofHash?: string;
  zkReceiptStatus?: 'none' | 'proving' | 'verified';
}

/** A sealed, stored transaction record. Sensitive payload is ciphertext. */
export interface TransactionRecord {
  txId: string;
  commitment: string;
  verificationStatus: string;
  policyStatus: string;
  settlementStatus: string;
  createdAt: number;
  protected: SealedBox;
  sourceTx?: string;
  attestationStatus: 'mirror' | 'proving' | 'verified' | 'a2a-delegation';
  attestationTx?: string;
  settlementTx?: string;
  escrowTx?: string;
  mandateId?: string;
  zkProofHash?: string;
  zkReceiptStatus?: 'none' | 'proving' | 'verified';
}

/** AES-256-GCM sealed box (base64), `tag` is the authentication tag. */
export interface SealedBox {
  alg: 'AES-256-GCM';
  iv: string;
  tag: string;
  ct: string;
}

export interface AuditorAccount {
  auditor: string;
  authorized: boolean;
  scope: 'all' | string[];
  authorizedAt: number;
  revokedAt?: number;
}

export interface DisclosureOptions {
  /** Subset of ProtectedData keys to disclose. Undefined/[] = the whole bundle. */
  fields?: string[];
}

export interface AuditAccessRequest {
  auditor: string; // claimed signer
  resource: string; // exact endpoint path being requested (anti-replay on other endpoints)
  txId: string;
  nonce: string; // uint256 hex
  expiresAt: number; // unix seconds
  signature: string;
}

export interface SettlementPreimage {
  salt: string;
  provider: string;
  amount: string;
  serviceId: string;
}