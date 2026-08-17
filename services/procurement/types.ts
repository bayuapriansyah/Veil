/**
 * VEIL Phase 5 — AI procurement agent types.
 *
 * The agent purchases verified market-data services (and any other service a
 * mandate allows) on behalf of its user, always honoring the mandate that is
 * authoritative on the SettlementLedger. The agent NEVER gains privileged
 * capabilities: it cannot raise budgets, revoke/modify mandates, bypass
 * escrow, mark payment/fulfillment verified, or settle.
 *
 * All money-bearing amounts are BigInt atoms (`*Atoms`). Optional "whole
 * dollar" display values use `string`/`number` so they survive JSON round
 * trips without the classic BigInt serialization bug.
 */
import { X402PaymentRequirement } from '../provider/types';

/** The only tools the agent may ever call. No privileged/settlement tools exist. */
export const TOOL_NAMES = [
  'searchProviders',
  'getProviderDetails',
  'checkMandate',
  'checkBudget',
  'checkReputation',
  'requestService',
  'makePayment',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Names that look privileged/settlement-related and MUST be rejected outright. */
export const PRIVILEGED_RESERVED = [
  'settle',
  'settleOrder',
  'refund',
  'releaseEscrow',
  'revoke',
  'revokeMandate',
  'increaseBudget',
  'setBudget',
  'modifyMandate',
  'markVerified',
  'markPaymentVerified',
  'markFulfillmentVerified',
  'deploy',
];

/** A service offering discovered from a provider catalog. */
export interface ServiceOffering {
  provider: string;
  serviceId: string;
  name: string;
  description: string;
  pricePerCallAtoms: bigint;
  reputation: number; // star rating 1-5; 0 = unrated; < 3 excluded
}

/** Provider profile returned by getProviderDetails. */
export interface ProviderProfile {
  provider: string;
  operator: string;
  reputation: number;
  scheme: string;
  services: ServiceOffering[];
  activeMandates: number;
}

/** Snapshot of a mandate as the agent sees it (read mirror of the ledger). */
export interface MandateView {
  mandateId: number;
  owner: string;
  agentId: number;
  serviceId: string;
  budgetAtoms: string;
  spentAtoms: string;
  remainingAtoms: string;
  expiresAt: number;
  revoked: boolean;
  active: boolean;
}

/** A payment offer produced by `requestService` (the ONLY payment path). */
export interface PurchaseOffer {
  orderId: bigint;
  provider: string;
  serviceId: string;
  serviceName: string;
  amountAtoms: bigint;
  requirement: X402PaymentRequirement;
}

/** Result of `makePayment` (the ONLY gate for actually paying). */
export interface PurchaseResult {
  ok: boolean;
  orderId?: bigint;
  provider?: string;
  serviceId?: string;
  status?: number;
  paymentVerified?: boolean;
  fulfillmentVerified?: boolean;
  escrowStatus?: string;
  error?: string;
}

/** A step of the deterministic procurement plan. */
export interface PlanStep {
  index: number;
  tool: ToolName;
  args: Record<string, string | number>;
  rationale: string;
}

export interface ProcurementPlan {
  task: string;
  serviceId: string;
  steps: PlanStep[];
}

export interface ProcurementOutcome {
  ok: boolean;
  task: string;
  planner: 'deterministic' | 'llm';
  plan: ProcurementPlan;
  results: Record<string, ToolCallRecord>;
  orderId?: string;
  serviceId?: string;
  provider?: string;
  escrowStatus?: string;
  paymentVerified?: boolean;
  fulfillmentVerified?: boolean;
  error?: string;
}

export interface ToolCallRecord {
  args: Record<string, string | number>;
  ok: boolean;
  data?: unknown;
  error?: string;
}