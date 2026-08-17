/**
 * VEIL demo adapter — the VEIL payment rail.
 *
 * This adapter bridges the x402 HTTP handshake to VEIL's own payment +
 * attestation architecture. It is EXPLICITLY a demo adapter and is NOT
 * official x402 infrastructure:
 *
 *  - It advertises a VENDOR scheme `veil-exact` (NOT the official `exact`).
 *  - Payment is recorded as an `AgentPayment` on the VEIL source contract
 *    (VeilSource.sol on Sepolia in the live architecture) rather than a USDC
 *    transferWithAuthorization.
 *  - The agent signs an EIP-712 `VeilPayment` typed message. The server
 *    ECRECOVERs the signer and confirms a matching AgentPayment is recorded.
 *  - Fulfillment produces a deterministic result hash and records a
 *    `FulfillmentReceipt`, which the real architecture attests on Creditcoin
 *    before the SettlementEngine releases escrow.
 *
 * API of the adapter is the same regardless of whether it runs against the
 * in-memory SettlementLedger (demo/tests) or, in the future, the deployed
 * Creditcoin contracts.
 */
import {
  SigningKey,
  TypedDataEncoder,
  recoverAddress,
  solidityPackedKeccak256,
  keccak256,
  toUtf8Bytes,
  getAddress,
} from 'ethers';
import { SettlementLedger } from './ledger';
import { VeilAdapterPayload, X402PaymentRequirement, VerifyPaymentResult } from './types';

export const SERVICE_MARKET_DATA = keccak256(toUtf8Bytes('market-data'));
export const SERVICE_COMPUTE = keccak256(toUtf8Bytes('compute'));

/** Domain of the VEIL demo-adapter EIP-712 message (Sepolia chainId). */
export const VeilPaymentDomain = {
  name: 'VEIL Demo Adapter',
  version: '1',
  chainId: 11155111, // Ethereum Sepolia (VEIL source chain)
  verifyingContract: '0x0000000000000000000000000000000000000000' as string, // set per provider
};

const VEIL_PAYMENT_TYPES = {
  VeilPayment: [
    { name: 'orderId', type: 'uint256' },
    { name: 'agent', type: 'address' },
    { name: 'provider', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'serviceId', type: 'bytes32' },
    { name: 'transactionRef', type: 'bytes32' },
  ],
};

export interface AdapterConfig {
  /** Provider address that payments are made to (shown in requirements). */
  providerAddress: string;
  /** Settlement ledger backing the demo (in-memory mirror of the contracts). */
  ledger: SettlementLedger;
  /** Units per atomic token (scale for the amount, e.g. WEI). */
  amountScale?: bigint;
  /** Set to a real VeilSource address if the live source chain is wired up. */
  sourceContractAddress?: string;
}

export class VeilAdapter {
  readonly config: AdapterConfig;

  constructor(config: AdapterConfig) {
    this.config = {
      amountScale: 1n,
      ...config,
    };
    VeilPaymentDomain.verifyingContract = config.providerAddress;
  }

  /** Advertised (vendor) scheme for the x402 handshake of this rail. */
  get scheme(): string {
    return 'veil-exact'; // vendor scheme — not the official x402 'exact'
  }

  buildRequirement(opts: {
    orderId: bigint;
    amount: bigint;
    resource: string;
    description: string;
    agent: string;
    name?: string;
    providerReputation?: number;
  }): X402PaymentRequirement {
    return {
      scheme: this.scheme,
      network: `eip155:${VeilPaymentDomain.chainId}`,
      maxAmountRequired: opts.amount.toString(),
      resource: opts.resource,
      description: opts.description,
      payTo: this.config.providerAddress,
      maxTimeoutSeconds: 120,
      asset: `0x${'00'.repeat(20)}`, // native asset on the VEIL source chain
      mimeType: 'application/json',
      extra: {
        orderId: opts.orderId.toString(),
        agent: opts.agent,
        provider: this.config.providerAddress,
        serviceId: SERVICE_MARKET_DATA,
        name: opts.name ?? 'Market Data Feed',
        serviceDescription: opts.description,
        providerReputation: opts.providerReputation ?? 0,
      },
    };
  }

  /**
   * Client-side: sign a VeilPayment typed message for a recorded AgentPayment.
   */
  signVeilPayment(opts: {
    privateKey: string;
    orderId: bigint;
    agent: string;
    provider: string;
    amount: bigint;
    serviceId: string;
  }): { signature: string; digest: string } {
    return signVeilPayment(opts);
  }

  /**
   * Provider-side: verify a VeilPayment payload.
   *  1. ECRECOVER the signer from the EIP-712 digest.
   *  2. Require the recovered signer to match the payload's claimed agent.
   *  3. Require the ledger to hold a matching AgentPayment (payment recorded).
   *  4. Require amount to cover the requirement.
   */
  verifyPayment(
    payload: VeilAdapterPayload,
    expectedPayTo: string,
    requiredAmount?: bigint,
  ): VerifyPaymentResult {
    const p = payload.payload;
    if (p.provider.toLowerCase() !== expectedPayTo.toLowerCase()) {
      return { ok: false, error: 'payTo mismatch' };
    }
    const orderId = BigInt(p.orderId);
    let recovered: string;
    try {
      const values = {
        orderId,
        agent: getAddress(p.agent),
        provider: getAddress(p.provider),
        amount: BigInt(p.amount),
        serviceId: p.serviceId,
        transactionRef: p.transactionRef,
      };
      const digest = TypedDataEncoder.hash(VeilPaymentDomain, VEIL_PAYMENT_TYPES, values);
      recovered = recoverAddress(digest, p.signature);
    } catch (e: any) {
      return { ok: false, error: `invalid signature: ${e?.message ?? e}` };
    }

    if (recovered.toLowerCase() !== p.agent.toLowerCase()) {
      return { ok: false, error: 'signature does not recover to agent' };
    }
    if (requiredAmount !== undefined && BigInt(p.amount) < requiredAmount) {
      return { ok: false, error: 'signed amount below requirement' };
    }

    // Confirm the payment was already recorded as an AgentPayment on the rail.
    if (!this.config.ledger.isPaymentVerified(orderId)) {
      return { ok: false, error: 'AgentPayment not recorded/verified for order' };
    }
    const escrow = this.config.ledger.escrow(orderId);
    const escrowSkipsOrderCheck = !escrow; // escrow-lite mode: no escrow required
    if (!escrowSkipsOrderCheck) {
      if (escrow!.amount !== BigInt(p.amount)) {
        return { ok: false, error: 'AgentPayment amount mismatch with order' };
      }
    }
    if (p.serviceId.toLowerCase() !== this.config.ledger.verifiedServiceIdOf(orderId).toLowerCase()) {
      return { ok: false, error: 'serviceId mismatch' };
    }

    return { ok: true, payer: recovered, orderId };
  }

  /**
   * Deterministic result hash for fulfillment evidence. Mirrors what the
   * real fulfillment flow would hash (order + service + payload/result).
   */
  computeResultHash(opts: {
    orderId: bigint;
    serviceId: string;
    provider: string;
    payloadRef: string;
  }): string {
    return solidityPackedKeccak256(
      ['uint256', 'bytes32', 'address', 'bytes32'],
      [opts.orderId, opts.serviceId, opts.provider, opts.payloadRef],
    );
  }

  /** Borrowed from ledger-compatible semantics: settle -> release (only if both verified). */
  settle(orderId: bigint): void {
    this.config.ledger.release(orderId);
  }

  refund(orderId: bigint): void {
    this.config.ledger.refund(orderId);
  }
}

/**
 * Standalone EIP-712 VeilPayment signature (agent client side).
 */
export function signVeilPayment(opts: {
  privateKey: string;
  orderId: bigint;
  agent: string;
  provider: string;
  amount: bigint;
  serviceId: string;
}): { signature: string; digest: string } {
  const sigKey = new SigningKey(opts.privateKey);
  const values = {
    orderId: opts.orderId,
    agent: getAddress(opts.agent),
    provider: getAddress(opts.provider),
    amount: opts.amount,
    serviceId: opts.serviceId,
    transactionRef: keccak256(toUtf8Bytes(`${opts.orderId}`)),
  };
  const digest = TypedDataEncoder.hash(VeilPaymentDomain, VEIL_PAYMENT_TYPES, values);
  const signature = sigKey.sign(digest).serialized;
  return { signature, digest };
}