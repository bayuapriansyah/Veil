/**
 * VEIL demo — the AI agent client.
 *
 * Implements the agentic payment flow against a VEIL provider:
 *
 *   Agent discovery
 *     -> GET /api/market-data             (returns 402 + PAYMENT-REQUIRED)
 *     -> pick a PaymentRequirement
 *     -> record AgentPayment on the VEIL rail (POST /api/payments)
 *     -> sign EIP-712 VeilPayment with the wallet key
 *     -> retry GET /api/market-data with X-PAYMENT header
 *     -> 200 + market data (+ PAYMENT-RESPONSE)
 *     -> then verify order status / can settle [escrow release]
 *     -> or mark refund when fulfillment is missing [refund]
 *
 * The client speaks the real x402 HTTP handshake (402, PAYMENT-REQUIRED,
 * X-PAYMENT, PAYMENT-RESPONSE) but the payment itself settles through the VEIL
 * demo adapter scheme `veil-exact` — NOT the official x402 `exact` scheme.
 * Any use of `exact` would require a live USDC/facilitator node.
 */
import { VeilPaymentDomain, SERVICE_MARKET_DATA, signVeilPayment } from '../provider/adapter';
import { X402PaymentRequired, X402PaymentRequirement } from '../provider/types';
import { base64Json } from '../provider/server';
import { keccak256, toUtf8Bytes } from 'ethers';

export interface OperatorResult {
  ok: boolean;
  error?: string;
}

export interface AgentConfig {
  baseUrl: string;
  providerAddress: string;
  operatorPrivateKey: string; // wallet that signs the VeilPayment + can settle/refund
  agentAddress: string;
}

export class VeilAgent {
  constructor(public config: AgentConfig) {}

  /** Step 0: discovery — fetch payment requirements for a resource. */
  async discover(resource = '/api/market-data'): Promise<X402PaymentRequired> {
    const res = await fetch(`${this.config.baseUrl}${resource}`);
    if (res.status !== 402) {
      throw new Error(`expected 402 during discovery, got ${res.status}`);
    }
    const header = res.headers.get('payment-required');
    if (!header) throw new Error('missing PAYMENT-REQUIRED header');
    const req = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as X402PaymentRequired;
    return req;
  }

  async recordAgentPayment(opts: { orderId: bigint; amount: bigint; serviceId: string; agent: string }): Promise<void> {
    const res = await fetch(`${this.config.baseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderId: opts.orderId.toString(),
        agent: opts.agent,
        amount: opts.amount.toString(),
        serviceId: opts.serviceId,
      }),
    });
    if (!res.ok) throw new Error(`recordAgentPayment failed: ${res.status}`);
  }

  /**
   * The full agentic flow: discover -> pay -> retry -> receive data.
   * @returns the response body and the raw RES object.
   */
  async purchaseMarketData(opts: {
    orderId: bigint;
    amount: bigint;
    symbol?: string;
    privateKey: string;
    serviceId?: string;
    useScheme?: string;
  }): Promise<{ status: number; body: unknown; headers: Headers }> {
    const req = await this.discover('/api/market-data');
    const accepted = req.accepts.find((a) => a.scheme === (opts.useScheme ?? 'veil-exact'));
    if (!accepted) throw new Error(`provider does not accept scheme ${opts.useScheme}`);
    const serviceId = opts.serviceId ?? SERVICE_MARKET_DATA;
    await this.recordAgentPayment({
      orderId: opts.orderId,
      amount: opts.amount,
      serviceId,
      agent: this.config.agentAddress,
    });
    return this.retryWithPayment(opts, accepted);
  }

  /** Retry the resource with the X-PAYMENT header. */
  async retryWithPayment(
    opts: {
      orderId: bigint;
      amount: bigint;
      privateKey: string;
      serviceId?: string;
      symbol?: string;
      provider?: string;
      agent?: string;
    },
    accepted?: X402PaymentRequirement,
  ): Promise<{ status: number; body: unknown; headers: Headers }> {
    const serviceId = opts.serviceId ?? SERVICE_MARKET_DATA;
    const agent = opts.agent ?? this.config.agentAddress;
    const provider = opts.provider ?? this.config.providerAddress;

    const { signature } = signVeilPayment({
      privateKey: opts.privateKey,
      orderId: opts.orderId,
      agent,
      provider,
      amount: opts.amount,
      serviceId,
    });

    const payload = {
      x402Version: 2,
      accepted: {
        scheme: 'veil-exact',
        network: `eip155:${VeilPaymentDomain.chainId}`,
        amount: opts.amount.toString(),
        asset: `0x${'00'.repeat(20)}`,
        payTo: provider,
        maxTimeoutSeconds: 120,
        extra: { serviceId, provider, orderId: opts.orderId.toString() },
      },
      payload: {
        orderId: opts.orderId.toString(),
        agent,
        provider,
        serviceId,
        amount: opts.amount.toString(),
        nonce: `${Date.now()}`,
        transactionRef: keccak256(toUtf8Bytes(`${opts.orderId}`)), // must match what signVeilPayment signed
        signature,
      },
    };

    const qs = opts.symbol ? `?symbol=${encodeURIComponent(opts.symbol)}` : '';
    const res = await fetch(`${this.config.baseUrl}/api/market-data${qs}`, {
      headers: { 'x-payment': base64Json(payload) },
    });
    let body: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: res.status, body, headers: res.headers };
  }

  async orderStatus(orderId: bigint): Promise<unknown> {
    const res = await fetch(`${this.config.baseUrl}/api/orders/${orderId}`);
    return res.json();
  }

  async settle(orderId: bigint, operator: string): Promise<OperatorResult> {
    const res = await fetch(`${this.config.baseUrl}/api/settle/${orderId}`, {
      method: 'POST',
      headers: { 'x-operator': operator },
    });
    return res.json() as Promise<OperatorResult>;
  }

  async refund(orderId: bigint, operator: string): Promise<OperatorResult> {
    const res = await fetch(`${this.config.baseUrl}/api/refund/${orderId}`, {
      method: 'POST',
      headers: { 'x-operator': operator },
    });
    return res.json() as Promise<OperatorResult>;
  }
}

function orderIdFor(opts: { orderId: bigint }): bigint {
  return opts.orderId;
}