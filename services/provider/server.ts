/**
 * VEIL demo provider — a real HTTP server exposing the x402 handshake and the
 * VEIL payment rail.
 *
 * Endpoints:
 *   GET  /api/market-data              payment-gated market data endpoint
 *   GET  /api/orders/:orderId          order + attestation + escrow status
 *   POST /api/settle/:orderId          operator settlement (mirrors SettlementEngine.settle)
 *   POST /api/refund/:orderId          refund (mirrors SettlementEngine.refund)
 *   GET  /health
 *
 * x402 behavior (REAL):
 *   - without payment  -> HTTP 402 + `PAYMENT-REQUIRED` header (base64 JSON)
 *   - with payment     -> HTTP 200 + resource + `PAYMENT-RESPONSE` header
 *
 * Payment schemes accepted:
 *   - `exact`    : the official x402 exact/EIP-3009 scheme. The cryptographically
 *                  signed EIP-712 payload IS verified via ECRECOVER (real). Since
 *                  no live USDC/EVM node is wired into the demo, on-chain
 *                  settlement is NOT executed for this scheme.
 *   - `veil-exact`: the VEIL demo adapter's vendor scheme. Payment is an
 *                  `AgentPayment` recorded on the VEIL rail (mirrored in the
 *                  SettlementLedger); the agent's EIP-712 signature is ECRECOVER
 *                  verified, then fulfillment + settlement follow VEIL semantics.
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { keccak256, toUtf8Bytes } from 'ethers';

import { VeilAdapter, SERVICE_MARKET_DATA, VeilPaymentDomain } from './adapter';
import { SettlementLedger, EscrowStatus, Mandate, Escrow, OrderSupplement } from './ledger';
import { SettlementStateProvider, VeilLedger, VerifyPaymentResult, X402PaymentRequired } from './types';
import { verifyExactPayment, buildUsdcRequirement } from './x402';
import { MarketDataSource, MarketDataResult, createMarketDataSource } from './market-data-source';
import { isProductionMode } from '../config/mode';
import { OnChainStateProvider, loadOnChainStateProviderConfig } from './onchain-ledger';
import { MiddlewareConfig, RateLimiter, applyMiddleware, loadAuthConfig } from './middleware';

export interface MarketDataOptions {
  symbol?: string;
}

/** A service the provider offers (advertised in /api/providers + requirement extras). */
export interface ServiceInfo {
  serviceId: string;
  name: string;
  description: string;
  pricePerCallAtoms?: bigint;
}

const PRICE_PER_CALL_ATOMS = BigInt('1000000000000000'); // 0.001 ether-equivalent

export const DEFAULT_SERVICE: ServiceInfo = {
  serviceId: SERVICE_MARKET_DATA,
  name: 'Market Data Feed',
  description: 'Real-time market data (per-call)',
  pricePerCallAtoms: PRICE_PER_CALL_ATOMS,
};

export interface ProviderOptions {
  providerAddress: string;
  operatorAddress: string;
  /** If true, provider also advertises the real x402 exact/USDC scheme. */
  advertiseRealX402?: boolean;
  usdc?: { chainId: number; address: string; payTo: string };
  pricePerCallAtoms?: bigint;
  /** Services this provider offers (defaults to the market-data feed). */
  catalog?: ServiceInfo[];
  /** Provider star rating 1-5; 0 = unrated. Providers scoring < 3 are excluded. */
  reputation?: number;
  /** Settlement state provider (demo ledger or on-chain contracts). */
  ledger?: SettlementStateProvider;
  /** Market data source (mock or real API). */
  marketSource?: MarketDataSource;
  /** TLS cert/key paths for HTTPS (optional). */
  tls?: { certPath: string; keyPath: string };
  /** Middleware configuration (auth, rate limit, CORS). */
  middleware?: MiddlewareConfig;
  /** Rate limit requests per minute (default: 100). 0 = unlimited. */
  rateLimitMaxRequests?: number;
}

export function base64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

export function decodeBase64Json<T>(header: string | undefined): T | null {
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export class VeilProvider {
  adapter: VeilAdapter;
  ledger: VeilLedger;
  marketSource: MarketDataSource;
  opts: Required<Omit<ProviderOptions, 'usdc' | 'ledger' | 'marketSource' | 'tls' | 'middleware' | 'rateLimitMaxRequests'>> & Pick<ProviderOptions, 'usdc' | 'ledger' | 'marketSource' | 'tls' | 'middleware' | 'rateLimitMaxRequests'>;

  constructor(opts: ProviderOptions) {
    this.opts = {
      advertiseRealX402: false,
      pricePerCallAtoms: PRICE_PER_CALL_ATOMS,
      reputation: 0,
      catalog: [DEFAULT_SERVICE],
      ...opts,
    };
    // Use injected ledger or create a new SettlementLedger (demo mode).
    this.ledger = (opts.ledger ?? new SettlementLedger()) as typeof this.ledger;
    this.adapter = new VeilAdapter({ providerAddress: opts.providerAddress, ledger: this.ledger as SettlementStateProvider });
    if (this.opts.reputation) this.ledger.registerReputation(this.opts.providerAddress, this.opts.reputation);
    // Use injected market source or create one from env config.
    this.marketSource = opts.marketSource ?? createMarketDataSource(opts.providerAddress);
  }

  /** Services offered by this provider (resolved defaults applied). */
  catalogEntries(): ServiceInfo[] {
    return this.opts.catalog!.map((s) => ({ ...s, pricePerCallAtoms: s.pricePerCallAtoms ?? this.opts.pricePerCallAtoms }));
  }

  private serviceOf(serviceId: string): ServiceInfo | undefined {
    return this.catalogEntries().find((s) => s.serviceId.toLowerCase() === serviceId.toLowerCase());
  }

  /** The x402 PaymentRequirements advertised for /api/market-data. */
  paymentRequirements(resource = `http://localhost/api/market-data`): X402PaymentRequired {
    const service = this.serviceOf(SERVICE_MARKET_DATA) ?? DEFAULT_SERVICE;
    const requirement = this.adapter.buildRequirement({
      orderId: 0n, // orderId is client-chosen; placeholder for the flow
      amount: service.pricePerCallAtoms ?? this.opts.pricePerCallAtoms,
      resource,
      description: service.description,
      agent: '0x' + '00'.repeat(20),
      name: service.name,
      providerReputation: this.opts.reputation ?? 0,
    });
    const accepts = [requirement];
    if (this.opts.advertiseRealX402) {
      accepts.push(
        buildUsdcRequirement({
          payTo: this.opts.usdc?.payTo ?? this.opts.providerAddress,
          amountAtoms: '10000', // 0.01 USDC
          resource,
          description: 'VEIL market data (official x402 exact/USDC)',
          chainId: this.opts.usdc?.chainId ?? 84532,
          usdcAddress: this.opts.usdc?.address ?? '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        }),
      );
    }
    return { x402Version: 2, error: 'X-PAYMENT header is required', accepts };
  }

  /**
   * Core payment-gated handler for a resource.
   * @returns {status, headers, body} — does not write the HTTP response itself.
   */
  async gatePayment(
    res: IncomingMessage,
    resourceUrl: string,
    providerAddress: string,
  ): Promise<{ allowed: true; orderId: bigint; payer: string } | { allowed: false; status: number; headers: Record<string, string>; error: string }> {
    const paymentHeader = headerStr(res.headers['x-payment'] ?? res.headers['payment-signature']);
    if (!paymentHeader) {
      return {
        allowed: false,
        status: 402,
        headers: { 'PAYMENT-REQUIRED': base64Json(this.paymentRequirements(resourceUrl)) },
        error: 'X-PAYMENT header is required',
      };
    }

    // Try real x402 exact scheme first, then the VEIL adapter scheme.
    const raw = decodeBase64Json<unknown>(paymentHeader);
    if (!raw) {
      return { allowed: false, status: 400, headers: {}, error: 'malformed X-PAYMENT header' };
    }
    const scheme = (raw as { accepted?: { scheme?: string } }).accepted?.scheme;

    if (scheme === 'exact') {
      const payload = raw as import('./types').X402EIP3009Payload;
      const result = verifyExactPayment(payload, providerAddress);
      return this._x402GateResult(result, resourceUrl);
    }
    if (scheme === 'veil-exact') {
      const payload = raw as import('./types').VeilAdapterPayload;
      return await this._veilGateResult(payload, resourceUrl);
    }
    return { allowed: false, status: 402, headers: {}, error: `unsupported scheme: ${scheme}` };
  }

  private _x402GateResult(
    result: VerifyPaymentResult,
    resourceUrl: string,
  ): { allowed: true; orderId: bigint; payer: string } | { allowed: false; status: number; headers: Record<string, string>; error: string } {
    if (!result.ok) {
      return { allowed: false, status: 402, headers: { 'PAYMENT-REQUIRED': base64Json({ x402Version: 2, error: result.error, accepts: this.paymentRequirements(resourceUrl).accepts }) }, error: result.error ?? 'payment rejected' };
    }
    // Exact/EIP-3009 payments have no VEIL order: mark a synthetic fulfilled order.
    const orderId = BigInt(keccak256(toUtf8Bytes(`x402-${result.payer}-${Date.now()}`)).slice(0, 16));
    return { allowed: true, orderId, payer: result.payer! };
  }

  private async _veilGateResult(
    payload: import('./types').VeilAdapterPayload,
    resourceUrl: string,
  ): Promise<{ allowed: true; orderId: bigint; payer: string } | { allowed: false; status: number; headers: Record<string, string>; error: string }> {
    const result = await this.adapter.verifyPayment(payload, this.opts.providerAddress, this.opts.pricePerCallAtoms);
    if (!result.ok) {
      return { allowed: false, status: 402, headers: { 'PAYMENT-REQUIRED': base64Json({ x402Version: 2, error: result.error, accepts: this.paymentRequirements(resourceUrl).accepts }) }, error: result.error ?? 'payment rejected' };
    }
    return { allowed: true, orderId: BigInt(result.orderId ?? 0n), payer: result.payer ?? '' };
  }

  // --- resource handlers -------------------------------------------------- //

  async marketData(symbol = 'ETH/USD'): Promise<MarketDataResult> {
    try {
      return await this.marketSource.getMarketData(symbol);
    } catch {
      // Fallback to static data if market source fails
      return {
        symbol,
        price: '2.42',
        updatedAt: new Date().toISOString(),
        provider: this.opts.providerAddress,
      };
    }
  }

  /**
   * Provider-side payment recording — mirrors `VeilSource.recordAgentPayment`
   * on the source chain (Sepolia) followed by the worker proving the tx and
   * the AttestationReceiver marking `paymentsVerified`. In the demo this writes
   * straight into the SettlementLedger with the attestation flags set.
   */
  recordAgentPayment(opts: {
    orderId: bigint;
    agent: string;
    amount: bigint;
    serviceId: string;
    /** Optional explicit mandate; otherwise the provider picks the active one for the service. */
    mandateId?: number;
  }): { ok: boolean; error?: string } {
    try {
      const service = this.serviceOf(opts.serviceId);
      let mandateId = opts.mandateId;
      if (mandateId === undefined) {
        // Prefer the caller's active mandate for this service (mirrors MandateManager).
        mandateId = this.ledger.findActiveMandate(this.opts.operatorAddress, opts.serviceId)?.mandateId;
      }
      if (mandateId === undefined) {
        // Ensure a default mandate exists (mirrors the deployed MandateManager setup).
        const mandate = this.ledger.createMandate({
          owner: this.opts.operatorAddress,
          agentId: 1,
          budget: this.opts.pricePerCallAtoms * 10_000n,
          serviceId: opts.serviceId,
        });
        mandateId = mandate.mandateId;
      }
      this.ledger.createEscrow({
        orderId: opts.orderId,
        mandateId,
        provider: this.opts.providerAddress,
        amount: opts.amount,
      });
      this.ledger.charge({ orderId: opts.orderId, payer: opts.agent });
      this.ledger.markPaymentVerified(opts.orderId, opts.amount, opts.serviceId, opts.agent);
      // Inject order supplemental fields at checkout so the client can verify what it bought.
      this.ledger.recordOrderSupplement(opts.orderId, {
        serviceName: service?.name ?? DEFAULT_SERVICE.name,
        serviceDescription: service?.description ?? DEFAULT_SERVICE.description,
        providerReputation: this.opts.reputation ?? 0,
      });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'payment recording failed' };
    }
  }

  /** After a valid payment, the provider fulfills: records fulfillment + result hash. */
  async fulfill(orderId: bigint, providerAddress: string, serviceId: string, payloadRef = keccak256(toUtf8Bytes('result'))): Promise<{ resultHash: string; fulfillmentVerified: boolean }> {
    const resultHash = this.adapter.computeResultHash({ orderId, serviceId, provider: providerAddress, payloadRef });
    // Mirrors: FulfillmentReceipt event -> Attestcoin verification -> verified.
    this.ledger.markFulfillmentVerified(orderId);
    return { resultHash, fulfillmentVerified: await this.ledger.isFulfillmentVerified(orderId) };
  }

  // --- settlement / refund (mirrors SettlementEngine) --------------------- //

  async settle(orderId: bigint, caller?: string): Promise<{ ok: boolean; error?: string }> {
    if (caller && caller.toLowerCase() !== this.opts.operatorAddress.toLowerCase()) return { ok: false, error: 'Unauthorized' };
    if ((await this.ledger.escrowStatus(orderId)) !== EscrowStatus.Locked) return { ok: false, error: 'EscrowNotLocked' };
    if (!(await this.ledger.isPaymentVerified(orderId))) return { ok: false, error: 'PaymentNotVerified' };
    if (!(await this.ledger.isFulfillmentVerified(orderId))) return { ok: false, error: 'FulfillmentNotVerified' };
    try {
      this.ledger.release(orderId);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'settlement failed' };
    }
  }

  async refund(orderId: bigint, caller?: string): Promise<{ ok: boolean; error?: string }> {
    if (caller && caller.toLowerCase() !== this.opts.operatorAddress.toLowerCase()) return { ok: false, error: 'Unauthorized' };
    if ((await this.ledger.escrowStatus(orderId)) !== EscrowStatus.Locked) return { ok: false, error: 'EscrowNotLocked' };
    try {
      this.ledger.refund(orderId);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'refund failed' };
    }
  }
}

// ------------------------------------------------------------------------- //
//  HTTP server wiring                                                        //
// ------------------------------------------------------------------------- //

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function headerStr(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function createVeilServer(opts: ProviderOptions) {
  const provider = new VeilProvider(opts);
  const baseResource = `http://localhost/api/market-data`;

  // Set up rate limiter if configured
  const limiter = (opts.rateLimitMaxRequests ?? 100) > 0
    ? new RateLimiter({ maxRequests: opts.rateLimitMaxRequests ?? 100 })
    : undefined;
  const mwConfig: MiddlewareConfig = opts.middleware ?? {};

  // Sweep expired rate limit entries every 5 minutes
  if (limiter) setInterval(() => limiter.sweep(), 300_000).unref();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Apply middleware (CORS, rate limit, auth)
    const mwResult = applyMiddleware(req, res, mwConfig, limiter);
    if (mwResult) {
      return json(res, mwResult.status, { error: mwResult.error }, mwResult.headers);
    }

    const url = req.url ?? '/';
    const [path, query] = url.split('?');

    if (req.method === 'GET' && (path === '/health' || path.startsWith('/health'))) {
      return json(res, 200, { status: 'ok', scheme: provider.adapter.scheme });
    }

    if (req.method === 'GET' && path === '/api/market-data') {
      provider.gatePayment(req, baseResource, opts.providerAddress).then(async (gate) => {
        if (!gate.allowed) {
          return json(res, gate.status, { error: gate.error, x402Version: 2 }, gate.headers);
        }
        const symbol = query === undefined ? 'ETH/USD' : new URLSearchParams(query.replace(/^\?/, '')).get('symbol') ?? 'ETH/USD';
        const data = await provider.marketData(symbol);
        const fulfillment = await provider.fulfill(gate.orderId, opts.providerAddress, SERVICE_MARKET_DATA);
        const paymentResponse = { success: true, orderId: gate.orderId.toString(), resultHash: fulfillment.resultHash };
        return json(res, 200, data, { 'PAYMENT-RESPONSE': base64Json(paymentResponse) });
      }).catch((err) => {
        return json(res, 500, { error: err?.message ?? 'internal error' });
      });
      return;
    }

    if (req.method === 'POST' && path === '/api/payments') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const result = provider.recordAgentPayment({
            orderId: BigInt(parsed.orderId),
            agent: parsed.agent,
            amount: BigInt(parsed.amount),
            serviceId: parsed.serviceId,
          });
          return json(res, result.ok ? 201 : 422, result.ok ? { ok: true } : result);
        } catch (e: any) {
          return json(res, 400, { error: e?.message ?? 'bad payment' });
        }
      });
      return;
    }

    if (req.method === 'GET' && path === '/api/providers') {
      const services = provider.catalogEntries().map((s) => ({
        serviceId: s.serviceId,
        name: s.name,
        description: s.description,
        pricePerCallAtoms: (s.pricePerCallAtoms ?? 0n).toString(),
      }));
      return json(res, 200, {
        provider: opts.providerAddress,
        operator: opts.operatorAddress,
        reputation: provider.opts.reputation ?? 0,
        scheme: provider.adapter.scheme,
        services,
      });
    }

    if (req.method === 'GET' && path === '/api/mandates') {
      const mandates = provider.ledger.activeMandates().map((m) => ({
        mandateId: m.mandateId,
        owner: m.owner,
        agentId: m.agentId,
        serviceId: m.serviceId,
        budgetAtoms: m.budget.toString(),
        spentAtoms: m.spent.toString(),
        remainingAtoms: (m.budget - m.spent).toString(),
        expiresAt: m.expiresAt,
        revoked: m.revoked,
        active: true,
      }));
      return json(res, 200, { mandates });
    }

    if (req.method === 'GET' && path.startsWith('/api/orders/')) {
      const orderId = BigInt(path.split('/')[3] ?? '0');
      const escrow = provider.ledger.escrow(orderId);
      const supplement = provider.ledger.orderSupplement(orderId);
      Promise.all([
        provider.ledger.isPaymentVerified(orderId),
        provider.ledger.isFulfillmentVerified(orderId),
        provider.ledger.verifiedServiceIdOf(orderId),
      ]).then(([paymentVerified, fulfillmentVerified, serviceId]) => {
        return json(res, 200, {
          orderId: orderId.toString(),
          escrowStatus: escrow ? EscrowStatus[escrow.status] : 'None',
          paymentVerified,
          fulfillmentVerified,
          serviceId,
          provider: escrow?.provider,
          payer: escrow?.payer,
          serviceName: supplement?.serviceName,
          serviceDescription: supplement?.serviceDescription,
          providerReputation: supplement?.providerReputation,
        });
      }).catch((err) => {
        return json(res, 500, { error: err?.message ?? 'internal error' });
      });
      return;
    }

    if (req.method === 'POST' && path.startsWith('/api/settle/')) {
      const orderId = BigInt(path.split('/')[3] ?? '0');
      const caller = headerStr(req.headers['x-operator']);
      provider.settle(orderId, caller).then((result) => {
        return json(res, result.ok ? 200 : 422, result.ok ? { ok: true } : result);
      }).catch((err) => {
        return json(res, 500, { error: err?.message ?? 'internal error' });
      });
      return;
    }

    if (req.method === 'POST' && path.startsWith('/api/refund/')) {
      const orderId = BigInt(path.split('/')[3] ?? '0');
      const caller = headerStr(req.headers['x-operator']);
      provider.refund(orderId, caller).then((result) => {
        return json(res, result.ok ? 200 : 422, result.ok ? { ok: true } : result);
      }).catch((err) => {
        return json(res, 500, { error: err?.message ?? 'internal error' });
      });
      return;
    }

    if (req.method === 'GET' && path === '/scheme') {
      return json(res, 200, { scheme: provider.adapter.scheme, note: 'veil-exact is a VEIL demo-adapter vendor scheme, NOT official x402' });
    }

    return json(res, 404, { error: 'not found' });
  });

  (server as unknown as { __provider?: VeilProvider }).__provider = provider;
  return server;
}

export async function startProvider(opts: ProviderOptions, port = 0): Promise<{ server: ReturnType<typeof createVeilServer>; port: number; provider: VeilProvider }> {
  const server = createVeilServer(opts);

  // TLS: if cert+key are provided, wrap in HTTPS
  let actualServer: ReturnType<typeof createVeilServer> = server;
  if (opts.tls?.certPath && opts.tls?.keyPath) {
    try {
      const cert = readFileSync(opts.tls.certPath);
      const key = readFileSync(opts.tls.keyPath);
      const httpsServer = createHttpsServer({ cert, key }, (req, res) => server.emit('request', req, res));
      actualServer = httpsServer as unknown as ReturnType<typeof createVeilServer>;
      // Copy __provider ref
      (httpsServer as unknown as { __provider?: VeilProvider }).__provider = (server as unknown as { __provider: VeilProvider }).__provider;
    } catch (e: any) {
      console.warn(`TLS setup failed (${e?.message}), falling back to HTTP`);
    }
  }

  await new Promise<void>((resolve) => actualServer.listen(port, resolve));
  const address = actualServer.address() as AddressInfo;
  return { server: actualServer, port: address.port, provider: (actualServer as unknown as { __provider: VeilProvider }).__provider };
}

// Standalone runner: node services/provider/server.ts (uses .env values).
if (require.main === module) {
  const dotenv = require('dotenv');
  dotenv.config();
  const operatorAddress = process.env.PROVIDER_OPERATOR_ADDRESS ?? '0x' + '11'.repeat(20);
  const providerAddress = process.env.VEIL_PROVIDER_ADDRESS ?? '0x' + '22'.repeat(20);
  const port = Number(process.env.PROVIDER_PORT ?? 8080);

  const opts: ProviderOptions = { providerAddress, operatorAddress, advertiseRealX402: true };

  // Production mode: on-chain verification
  if (isProductionMode()) {
    const config = loadOnChainStateProviderConfig();
    if (config) {
      console.log('Production mode: using OnChainStateProvider for verification');
      opts.ledger = new OnChainStateProvider(config);
    } else {
      console.warn('Production mode detected but config incomplete — falling back to demo ledger');
    }
  }

  // TLS
  const certPath = process.env.TLS_CERT_PATH;
  const keyPath = process.env.TLS_KEY_PATH;
  if (certPath && keyPath) {
    opts.tls = { certPath, keyPath };
    console.log('TLS enabled');
  }

  // Middleware: auth, rate limit, CORS
  const auth = loadAuthConfig();
  const rateLimitMax = Number(process.env.PROVIDER_RATE_LIMIT_MAX ?? '100');
  if (auth || rateLimitMax > 0) {
    opts.middleware = { auth: auth ?? undefined };
    opts.rateLimitMaxRequests = rateLimitMax;
    if (auth) console.log(`API key auth enabled (${auth.keys.size} keys)`);
    console.log(`Rate limit: ${rateLimitMax} req/min`);
  }

  const protocol = opts.tls ? 'https' : 'http';
  startProvider(opts, port).then(({ server, port: actualPort }) => {
    console.log(`VEIL provider listening on ${protocol}://127.0.0.1:${actualPort}`);
    console.log(`advertised schemes: veil-exact (VEIL demo adapter), exact (real x402, verification-only)`);
  });
}