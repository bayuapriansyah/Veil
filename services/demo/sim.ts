/**
 * VEIL demo flow simulator.
 *
 * Runs the full agentic payment + fulfillment + settlement flow against an
 * in-process provider server:
 *
 *   Agent discovery -> 402 -> AgentPayment (POST /api/payments)
 *     -> X-PAYMENT retry -> 200 market data + FulfillmentReceipt
 *     -> settlement check [escrow release] or refund
 *
 * Everything runs against the VeilProvider's in-memory SettlementLedger, which
 * mirrors the verified Creditcoin contracts (EscrowManager / SettlementEngine /
 * MandateManager). No real chain is touched; no proof is fabricated.
 */
import { AddressInfo } from 'node:net';
import { Wallet } from 'ethers';

import { VeilProvider, createVeilServer, ProviderOptions } from '../provider/server';
import { EscrowStatus } from '../provider/ledger';
import { VeilAgent } from './agent';

export interface SimHandles {
  provider: VeilProvider;
  agent: VeilAgent;
  operator: string;
  close: () => Promise<void>;
  port: number;
  baseUrl: string;
}

export const OPERATOR = '0x' + '11'.repeat(20);
export const PROVIDER = '0x' + '22'.repeat(20);
/** Test-only signing key for the agent wallet (demo). Not a secret, not production. */
export const AGENT_PRIVATE_KEY = '0x' + '33'.repeat(32);
/** Agent address owns AGENT_PRIVATE_KEY so provider ECRECOVER passes. */
export const AGENT = new Wallet(AGENT_PRIVATE_KEY).address;

export async function startSim(opts: Partial<ProviderOptions> = {}): Promise<SimHandles> {
  const providerOptions: ProviderOptions = {
    providerAddress: PROVIDER,
    operatorAddress: OPERATOR,
    advertiseRealX402: true,
    ...opts,
  };
  const server = createVeilServer(providerOptions);
  const provider = (server as unknown as { __provider: VeilProvider }).__provider;
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const agent = new VeilAgent({ baseUrl, providerAddress: PROVIDER, operatorPrivateKey: AGENT_PRIVATE_KEY, agentAddress: AGENT });

  return {
    provider,
    agent,
    operator: OPERATOR,
    port,
    baseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export { EscrowStatus };

/** Run a canned demo and print the transcript (for `npm run demo`). */
export async function runDemoStory(): Promise<void> {
  const sim = await startSim();
  const orderId = 1001n;
  const amount = sim.provider.opts.pricePerCallAtoms;

  console.log('=== VEIL demo: agent purchases market data ===');
  console.log(`provider    : ${PROVIDER}`);
  console.log(`agent       : ${AGENT}`);
  console.log(`operator    : ${OPERATOR}`);

  console.log('\n[1] Agent discovery (unpaid request):');
  const discovery = await sim.agent.discover('/api/market-data');
  console.log(`  -> 402 Payment Required, accepts=${discovery.accepts.map((a) => a.scheme).join(', ')}`);

  console.log('\n[2] Agent records AgentPayment + signs VeilPayment, retries with X-PAYMENT:');
  const purchase = await sim.agent.purchaseMarketData({ orderId, amount, privateKey: AGENT_PRIVATE_KEY, symbol: 'BTC/USD' });
  console.log(`  -> HTTP ${purchase.status}`);
  console.log(`  -> market data: ${JSON.stringify(purchase.body)}`);
  if (purchase.headers.get('payment-response')) {
    console.log(`  -> PAYMENT-RESPONSE: ${purchase.headers.get('payment-response')}`);
  }

  console.log('\n[3] Fulfillment receipt recorded; order status:');
  console.log(`  ${JSON.stringify(await sim.agent.orderStatus(orderId))}`);

  console.log('\n[4] Operator settlement (escrow release):');
  console.log(`  ${JSON.stringify(await sim.agent.settle(orderId, OPERATOR))}`);

  console.log('\n[5] Order status after settlement:');
  console.log(`  ${JSON.stringify(await sim.agent.orderStatus(orderId))}`);

  await sim.close();
}

if (require.main === module) {
  runDemoStory().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}