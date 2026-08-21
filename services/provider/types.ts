/**
 * x402 protocol types (verified against the coinbase/x402 specification,
 * `specs/schemes/exact/scheme_exact_evm.md` and the Coinbase developer docs).
 */

/**
 * A `PaymentRequirement` as advertised by an x402 resource server in its
 * `402 Payment Required` response.
 */
export interface X402PaymentRequirement {
  /** Payment scheme, e.g. `exact`. */
  scheme: string;
  /** Network the payment must be sent on, e.g. `eip155:84532` for Base Sepolia. */
  network: string;
  /** Maximum amount required in atomic units, as a decimal string. */
  maxAmountRequired: string;
  /** URL of the resource being paid for. */
  resource: string;
  /** Human readable description. */
  description?: string;
  /** Address to pay value to (or contract representing the payment rail). */
  payTo: string;
  /** Maximum seconds the resource server will wait for the payment. */
  maxTimeoutSeconds: number;
  /** Asset identifier (token address, or `0x0` for native). */
  asset: string;
  /** Expected response content type. */
  mimeType?: string;
  /** Extra metadata specific to the scheme/network producer. */
  extra?: Record<string, unknown>;
}

/** Body of a 402 Payment Required response. */
export interface X402PaymentRequired {
  /** Version of the x402 protocol. */
  x402Version: number;
  /** Error message indicating payment is required. */
  error: string;
  /** List of acceptable payment requirements. */
  accepts: X402PaymentRequirement[];
}

/** EIP-3009 transferWithAuthorization parameter set (exact/EVM scheme). */
export interface EIP3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/** Incoming EIP-3009 payload carried in the X-PAYMENT header (exact/EVM scheme). */
export interface X402EIP3009Payload {
  x402Version: number;
  resource: { url: string; description?: string; mimeType?: string };
  accepted: {
    scheme: string;
    network: string;
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra?: { assetTransferMethod?: string; name?: string; version?: string };
  };
  payload: {
    signature: string;
    authorization: EIP3009Authorization;
  };
}

/**
 * VEIL demo-adapter payment payload carried in the X-PAYMENT header.
 *
 * This is NOT an official x402 payload. It is the demo adapter's own format:
 * the agent signs an EIP-712 `VeilPayment` message and references a payment
 * already recorded as an `AgentPayment` event on the VEIL source contract.
 */
export interface VeilAdapterPayload {
  x402Version: number;
  accepted: {
    scheme: string; // 'veil-exact' (vendor scheme, NOT the official 'exact')
    network: string;
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra?: { serviceId?: string; provider?: string; orderId?: string };
  };
  payload: {
    orderId: string;
    agent: string;
    provider: string;
    serviceId: string;
    amount: string;
    nonce: string;
    transactionRef: string;
    signature: string;
  };
}

/** Result of verifying a claimed payment. */
export interface VerifyPaymentResult {
  ok: boolean;
  /** On success: the payer (recovered signer). */
  payer?: string;
  /** On success: recovered provider / order context. */
  orderId?: bigint;
  error?: string;
}

// --------------------------------------------------------------------------- //
//  SettlementStateProvider — abstraction over demo (in-memory) vs on-chain     //
// --------------------------------------------------------------------------- //

export enum EscrowStatus {
  None = 0,
  Locked = 1,
  Released = 2,
  Refunded = 3,
}

/**
 * Read-only interface for settlement state.
 *
 * Both `SettlementLedger` (demo, in-memory) and `OnChainStateProvider`
 * (production, reads from Creditcoin contracts) implement this interface.
 * The provider server and adapter program against this interface so the
 * same code works in both modes.
 *
 * All methods return Promises for consistency — the on-chain provider
 * makes async RPC calls, while the demo ledger wraps sync results.
 */
export interface SettlementStateProvider {
  escrowStatus(orderId: bigint): Promise<EscrowStatus>;
  isPaymentVerified(orderId: bigint): Promise<boolean>;
  isFulfillmentVerified(orderId: bigint): Promise<boolean>;
  verifiedServiceIdOf(orderId: bigint): Promise<string>;
  activeMandateOf(owner: string, serviceId: string): Promise<{ mandateId: number; budget: bigint; spent: bigint } | undefined>;
  reputationOf(provider: string): Promise<number>;
  release?(orderId: bigint): void;
  refund?(orderId: bigint): void;
}