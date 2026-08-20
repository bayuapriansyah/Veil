/**
 * ProcurementShop — wires N in-process VEIL providers (each with its own
 * SettlementLedger + HTTP server) into one catalog the agent can shop from.
 *
 * The shop has NO privileged capabilities either: mandates are registered
 * straight onto each provider's ledger (which remains the authority), and the
 * shop can only perform the same purchase (requestService -> makePayment)
 * that runs through the real x402/VEIL rail.
 */
import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';

import { SERVICE_MARKET_DATA, signVeilPayment, VeilPaymentDomain } from '../provider/adapter';
import { SettlementLedger } from '../provider/ledger';
import { VeilProvider, createVeilServer, base64Json, ProviderOptions, ServiceInfo } from '../provider/server';
import { X402PaymentRequired } from '../provider/types';
import { recordAgentPayment } from '../attestation/record';
import {
  MandateView,
  PurchaseOffer,
  PurchaseResult,
  ProviderProfile,
  ServiceOffering,
} from './types';

export const OPERATOR = '0x' + '11'.repeat(20);
export const PROVIDER = '0x' + '22'.repeat(20);
export const AGENT_PRIVATE_KEY = '0x' + '33'.repeat(32);

export interface ShopService {
  serviceId: string;
  name: string;
  description: string;
  pricePerCallAtoms: bigint;
}

export interface ShopProviderConfig {
  address: string;
  operator?: string;
  reputation?: number; // star rating 1-5; 0 = unrated
  services?: ShopService[];
  advertiseRealX402?: boolean;
  pricePerCallAtoms?: bigint;
}

export interface ProcurementShopConfig {
  providers: ShopProviderConfig[];
  agentPrivateKey?: string;
  agentAddress?: string;
  operator?: string;
  /** Whole-dollar display budget for the user's mandate (string to avoid BigInt JSON bugs). */
  budgetDollars?: string;
  /** First auto-assigned order id. Default 1189n (pinned by tests). */
  orderIdSeed?: bigint;
}

export interface ShopHandle {
  provider: VeilProvider;
  server: Server;
  port: number;
  baseUrl: string;
}

export function atomsOf(value: bigint | number | string | undefined): bigint {
  return BigInt(value ?? 0);
}

const serviceKey = (serviceId: string): string => serviceId.toLowerCase();

/**
 * @returns {shop, close, port, baseUrl} — `close()` shuts down all servers.
 */
export async function createProcurementShop(
  config: ProcurementShopConfig,
): Promise<{ shop: ProcurementShop; close: () => Promise<void> }> {
  const privateKey = config.agentPrivateKey ?? AGENT_PRIVATE_KEY;
  const agentAddress = config.agentAddress && /^0x[0-9a-fA-F]{40}$/.test(config.agentAddress)
    ? config.agentAddress
    : new Wallet(privateKey).address;
  const shop = new ProcurementShop({ ...config, agentPrivateKey: privateKey, agentAddress });
  await shop.start();
  return {
    shop,
    close: () => shop.close(),
  };
}

export class ProcurementShop {
  readonly agentPrivateKey: string;
  readonly agentAddress: string;
  readonly operator: string;
  private handles = new Map<string, ShopHandle>();
  private offerings = new Map<string, ServiceOffering>(); // key: provider:serviceId
  private offers = new Map<string, PurchaseOffer>(); // key: orderId.toString()
  private nextOrderId = 1189n; // deterministic seed; tests may pin explicit order ids
  private mandates: MandateView[] = [];

  constructor(config: ProcurementShopConfig) {
    this.operator = config.operator ?? OPERATOR;
    this.agentPrivateKey = config.agentPrivateKey ?? AGENT_PRIVATE_KEY;
    if (config.orderIdSeed !== undefined) this.nextOrderId = config.orderIdSeed;
    this.agentAddress =
      config.agentAddress && /^0x[0-9a-fA-F]{40}$/.test(config.agentAddress)
        ? config.agentAddress
        : new Wallet(this.agentPrivateKey).address;

    for (const pc of config.providers) {
      const operator = pc.operator ?? this.operator;
      const providerOpts: ProviderOptions = {
        providerAddress: pc.address,
        operatorAddress: operator,
        advertiseRealX402: pc.advertiseRealX402 ?? false,
        reputation: pc.reputation ?? 5,
        pricePerCallAtoms: pc.pricePerCallAtoms,
        catalog: (pc.services ?? [defaultService(pc.pricePerCallAtoms)]).map((s): ServiceInfo => ({
          serviceId: s.serviceId,
          name: s.name,
          description: s.description,
          pricePerCallAtoms: s.pricePerCallAtoms ?? pc.pricePerCallAtoms,
        })),
      };
      const server = createVeilServer(providerOpts);
      const provider = (server as unknown as { __provider: VeilProvider }).__provider;
      this.handles.set(pc.address.toLowerCase(), { provider, server, port: 0, baseUrl: '' });

      for (const s of provider.catalogEntries()) {
        const offering: ServiceOffering = {
          provider: pc.address,
          serviceId: s.serviceId,
          name: s.name,
          description: s.description,
          pricePerCallAtoms: s.pricePerCallAtoms ?? 0n,
          reputation: pc.reputation ?? 0,
        };
        this.offerings.set(offerKey(pc.address, s.serviceId), offering);
      }
    }
  }

  async start(): Promise<void> {
    for (const [, h] of this.handles) {
      await new Promise<void>((resolve) => h.server.listen(0, resolve));
      const info = h.server.address() as AddressInfo;
      h.port = info.port;
      h.baseUrl = `http://127.0.0.1:${h.port}`;
    }
    // Re-register reputations now that ledgers exist (createVeilServer does this too).
    for (const offering of this.offerings.values()) {
      const handle = this.handles.get(offering.provider.toLowerCase());
      if (handle) handle.provider.ledger.registerReputation(offering.provider, offering.reputation);
    }
  }

  async close(): Promise<void> {
    for (const [, h] of this.handles) {
      await new Promise<void>((resolve) => h.server.close(() => resolve()));
    }
  }

  handleOf(provider: string): ShopHandle | undefined {
    return this.handles.get(provider.toLowerCase());
  }

  providerOf(provider: string): VeilProvider | undefined {
    return this.handles.get(provider.toLowerCase())?.provider;
  }

  ledgerOf(provider: string): SettlementLedger | undefined {
    return this.handles.get(provider.toLowerCase())?.provider.ledger;
  }

  /** Every provider ledger in the shop (each is the authority for its purchases). */
  ledgers(): Array<{ provider: string; ledger: SettlementLedger }> {
    return [...this.handles.entries()].map(([, h]) => ({ provider: h.provider.opts.providerAddress, ledger: h.provider.ledger }));
  }

  /**
   * Register a user mandate on EVERY provider ledger (each provider's ledger is
   * the authority for purchases against that provider). Mirrors MandateManager.
   */
  createMandate(opts: {
    serviceId: string;
    budgetAtoms: bigint;
    owner?: string;
    agentId?: number;
    expiresAt?: number;
  }): MandateView[] {
    for (const [, h] of this.handles) {
      h.provider.ledger.createMandate({
        owner: opts.owner ?? this.operator,
        agentId: opts.agentId ?? 1,
        budget: opts.budgetAtoms,
        serviceId: opts.serviceId,
        expiresAt: opts.expiresAt,
      });
    }
    return this.syncMandates();
  }

  /** Build the agent's read-mirror of all mandates on the providers' ledgers. */
  private syncMandates(): MandateView[] {
    const views: MandateView[] = [];
    for (const [, h] of this.handles) {
      for (const m of h.provider.ledger.activeMandates()) {
        const budget = m.budget;
        const spent = m.spent;
        const remaining = budget - spent;
        views.push({
          mandateId: m.mandateId,
          owner: m.owner,
          agentId: m.agentId,
          serviceId: m.serviceId,
          budgetAtoms: budget.toString(),
          spentAtoms: spent.toString(),
          remainingAtoms: remaining.toString(),
          expiresAt: m.expiresAt,
          revoked: m.revoked,
          active: remaining > 0n && !m.revoked,
        });
      }
    }
    this.mandates = views;
    return views;
  }

  listMandates(): MandateView[] {
    return this.syncMandates();
  }

  activeMandates(): MandateView[] {
    return this.syncMandates().filter((m) => m.active);
  }

  mandateOf(mandateId: number): MandateView | undefined {
    return this.syncMandates().find((m) => m.mandateId === mandateId);
  }

  // --- catalog / discovery ------------------------------------------------ //

  catalog(): ServiceOffering[] {
    return [...this.offerings.values()];
  }

  /** Discovery: eligible providers = offers the serviceId AND reputation >= 3. */
  searchProviders(serviceId: string): ServiceOffering[] {
    return this.catalog().filter((o) => serviceKey(o.serviceId) === serviceKey(serviceId) && o.reputation >= 3);
  }

  offering(provider: string, serviceId: string): ServiceOffering | undefined {
    return this.offerings.get(offerKey(provider, serviceId));
  }

  providerProfile(provider: string): ProviderProfile | undefined {
    const handle = this.handles.get(provider.toLowerCase());
    if (!handle) return undefined;
    const offered = [...this.offerings.values()].filter((o) => o.provider.toLowerCase() === provider.toLowerCase());
    return {
      provider,
      operator: handle.provider.opts.operatorAddress,
      reputation: handle.provider.opts.reputation ?? 0,
      scheme: handle.provider.adapter.scheme,
      services: offered,
      activeMandates: handle.provider.ledger.activeMandates().length,
    };
  }

  reputationOf(provider: string): number {
    return this.handles.get(provider.toLowerCase())?.provider.ledger.reputationOf(provider) ?? 0;
  }

  // --- purchasing (the ONLY payment path) --------------------------------- //

  reserveOrderId(): bigint {
    return this.nextOrderId++;
  }

  registerOffer(offer: PurchaseOffer): void {
    this.offers.set(offer.orderId.toString(), offer);
  }

  takeOffer(orderId: bigint): PurchaseOffer | undefined {
    return this.offers.get(orderId.toString());
  }

  async discoverRequirement(provider: string, resource = '/api/market-data'): Promise<X402PaymentRequired> {
    const handle = this.handles.get(provider.toLowerCase());
    if (!handle) throw new Error('ProviderNotKnown');
    const res = await fetch(`${handle.baseUrl}${resource}`);
    if (res.status !== 402) throw new Error(`expected 402 during discovery, got ${res.status}`);
    const header = res.headers.get('payment-required');
    if (!header) throw new Error('missing PAYMENT-REQUIRED header');
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as X402PaymentRequired;
  }

  /**
   * Execute the actual purchase over the real HTTP rail:
   *   POST /api/payments (record AgentPayment) then retry with X-PAYMENT.
   */
  async makePayment(opts: { offer: PurchaseOffer; symbol?: string }): Promise<PurchaseResult> {
    const { offer } = opts;
    const handle = this.handles.get(offer.provider.toLowerCase());
    if (!handle) return { ok: false, error: 'ProviderNotKnown' };
    const baseUrl = handle.baseUrl;
    const amount = offer.amountAtoms;

    const record = await fetch(`${baseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderId: offer.orderId.toString(),
        agent: this.agentAddress,
        amount: amount.toString(),
        serviceId: offer.serviceId,
      }),
    });
    if (!record.ok) {
      return { ok: false, error: `recordAgentPayment failed: HTTP ${record.status}` };
    }

    // Live source-chain record (soft-fail): emit a REAL AgentPayment event that
    // the Attestcoin worker will prove on Creditcoin. Failure never blocks the
    // HTTP rail — the mirror ledger stays authoritative for the UI.
    const onchain = await recordAgentPayment({
      orderId: offer.orderId,
      provider: offer.provider,
      amount,
      serviceId: offer.serviceId,
      transactionRef: keccak256(toUtf8Bytes(`${offer.orderId}`)),
    });

    const payload = {
      x402Version: 2,
      accepted: {
        scheme: 'veil-exact',
        network: `eip155:${VeilPaymentDomain.chainId}`,
        amount: amount.toString(),
        asset: `0x${'00'.repeat(20)}`,
        payTo: offer.provider,
        maxTimeoutSeconds: 120,
        extra: { serviceId: offer.serviceId, provider: offer.provider, orderId: offer.orderId.toString() },
      },
      payload: {
        orderId: offer.orderId.toString(),
        agent: this.agentAddress,
        provider: offer.provider,
        serviceId: offer.serviceId,
        amount: amount.toString(),
        nonce: `${Date.now()}`,
        transactionRef: keccak256(toUtf8Bytes(`${offer.orderId}`)),
        signature: '',
      },
    };

    const { signature } = signVeilPayment({
      privateKey: this.agentPrivateKey,
      orderId: offer.orderId,
      agent: this.agentAddress,
      provider: offer.provider,
      amount,
      serviceId: offer.serviceId,
    });
    payload.payload.signature = signature;

    const qs = opts.symbol ? `?symbol=${encodeURIComponent(opts.symbol)}` : '';
    const res = await fetch(`${baseUrl}/api/market-data${qs}`, {
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

    if (res.status !== 200) {
      const err = (body as { error?: string })?.error ?? `HTTP ${res.status}`;
      return { ok: false, error: err };
    }

    return {
      ok: true,
      orderId: offer.orderId,
      provider: offer.provider,
      serviceId: offer.serviceId,
      status: res.status,
      paymentVerified: handle.provider.ledger.isPaymentVerified(offer.orderId),
      fulfillmentVerified: handle.provider.ledger.isFulfillmentVerified(offer.orderId),
      escrowStatus: escrowLabel(handle.provider.ledger.escrowStatus(offer.orderId)),
      onchain: { txHash: onchain.txHash, error: onchain.error },
    };
  }
}

function offerKey(provider: string, serviceId: string): string {
  return `${provider.toLowerCase()}:${serviceKey(serviceId)}`;
}

function defaultService(pricePerCallAtoms?: bigint): ShopService {
  return {
    serviceId: SERVICE_MARKET_DATA,
    name: 'Market Data Feed',
    description: 'Real-time market data (per-call)',
    pricePerCallAtoms: pricePerCallAtoms ?? BigInt('1000000000000000'),
  };
}

function escrowLabel(status: number): string {
  return ['None', 'Locked', 'Released', 'Refunded'][status] ?? 'None';
}

/** Re-export for direct use by demos/tests. */
export { SERVICE_MARKET_DATA };