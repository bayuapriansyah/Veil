/**
 * VEIL console client helpers. BROWSER-SAFE: this module MUST NOT import
 * anything from `../services/*` (node crypto / ethers graph) or the server
 * runtime — those stay on the server. All state arrives over the API routes.
 */

export type TxStatus = 'PENDING' | 'VERIFIED' | 'FAILED' | 'REJECTED' | 'REFUNDED' | 'SETTLED';

export interface TimelineStage {
  key: string;
  label: string;
  status: TxStatus;
  note?: string;
}

export interface OrderDetail {
  orderId: string;
  serviceId: string;
  serviceLabel: string;
  provider: string;
  amountAtoms: string;
  ok: boolean;
  createdAt: number;
  resultHash?: string;
  error?: string;
  escrowStatus: 'None' | 'Locked' | 'Released' | 'Refunded';
  stages: TimelineStage[];
}

export interface MandateView {
  mandateId: number;
  owner: string;
  serviceId: string;
  serviceLabel: string;
  budgetAtoms: string;
  spentAtoms: string;
  remainingAtoms: string;
  expiresAt: number;
  revoked: boolean;
}

export interface ProviderView {
  provider: string;
  reputation: number;
  eligible: boolean;
  services: Array<{ serviceId: string; name: string; description: string; pricePerCallAtoms: string }>;
  activeMandates: number;
}

export interface AuditorView {
  auditor: string;
  authorized: boolean;
  revokedAt?: number;
}

export interface AuditTx {
  txId: string;
  commitment: string;
  verificationStatus: string;
  policyStatus: string;
  settlementStatus: string;
  createdAt: number;
  encrypted: boolean;
  sourceTx?: string;
  attestationStatus: 'mirror' | 'proving' | 'verified';
  attestationTx?: string;
}

export interface VeilState {
  agent: { address: string; status: 'active' | 'killed' };
  killSwitch: boolean;
  budgetAtoms: string;
  spentAtoms: string;
  remainingAtoms: string;
  reservedAtoms: string;
  reputation: { provider: string; score: number; reviews: number };
  verifiedTransactions: number;
  transactionCount: number;
  currentMandate: MandateView | null;
  providersCount: number;
  orderIds: string[];
  keySource: string;
  txsAtoms: string;
}

export const STAGE_SEQUENCE = [
  { key: 'authorization', label: 'Authorization' },
  { key: 'payment', label: 'Payment' },
  { key: 'payment-attestation', label: 'Payment Attestation' },
  { key: 'fulfillment', label: 'Fulfillment' },
  { key: 'fulfillment-attestation', label: 'Fulfillment Attestation' },
  { key: 'settlement', label: 'Settlement' },
] as const;

/** Pipeline node order for the economy canvas (fixed, real architecture). */
export const CANVAS_NODES = [
  'USER',
  'AI AGENT',
  'PROVIDER',
  'PAYMENT',
  'SOURCE CHAIN',
  'ATTESTCOIN',
  'CREDITCOIN',
  'SETTLEMENT',
] as const;

/** Stage key -> furthest canvas node index a VERIFIED stage reaches. */
export const STAGE_NODE_INDEX: Record<string, number> = {
  authorization: 1,
  payment: 2,
  'payment-attestation': 3,
  fulfillment: 4,
  'fulfillment-attestation': 5,
  settlement: 7,
};

export function atomsUsd(atoms: string | bigint): string {
  const n = Number(BigInt(atoms)) / 1e18;
  return n.toFixed(3);
}

export function shortAddress(addr: string, chars = 4): string {
  if (!addr || addr.length < 2) return addr;
  return `${addr.slice(0, 2 + chars)}…${addr.slice(-chars)}`;
}

export function txShort(txId: string): string {
  if (!txId) return txId;
  if (txId.startsWith('veil-')) return txId;
  return txId.slice(0, 10) + '…';
}

export function timeAgo(tsSec: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - tsSec);
  if (s < 5) return 'now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export const STATUS_STYLE: Record<TxStatus, { chip: string; dot: string; label: string }> = {
  PENDING: { chip: 'bg-pend/15 text-pend border-pend/50', dot: 'bg-pend', label: 'PENDING' },
  VERIFIED: { chip: 'bg-ok/15 text-ok border-ok/50', dot: 'bg-ok', label: 'VERIFIED' },
  FAILED: { chip: 'bg-bad/15 text-bad border-bad/50', dot: 'bg-bad', label: 'FAILED' },
  REJECTED: { chip: 'bg-bad/15 text-bad border-bad/50', dot: 'bg-bad', label: 'REJECTED' },
  REFUNDED: { chip: 'bg-mut/15 text-mut border-mut/50', dot: 'bg-mut', label: 'REFUNDED' },
  SETTLED: { chip: 'bg-ok/15 text-ok border-ok/50', dot: 'bg-ok', label: 'SETTLED' },
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new Error(err);
  }
  return body as T;
}