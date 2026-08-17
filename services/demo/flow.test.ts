/**
 * VEIL Phase 3/4 tests.
 *
 * Seven scenarios:
 *   1. unpaid request            -> 402
 *   2. successful payment        -> 200 + market data + fulfillment
 *   3. invalid payment           -> rejected (402/422)
 *   4. fulfillment               -> FulfillmentReceipt recorded, deterministic result hash
 *   5. missing fulfillment       -> settlement blocked
 *   6. escrow release            -> released after verified payment + fulfillment
 *   7. refund                    -> escrow refunded when fulfillment missing
 *
 * Runs against the in-process VeilProvider HTTP server + its SettlementLedger
 * (mirror of the verified Creditcoin contracts). No live chain required; the
 * attestation bits are the ledger's mirrors of the AttestationReceiver.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startSim, AGENT_PRIVATE_KEY, OPERATOR, PROVIDER, AGENT, SimHandles } from './sim';
import { SERVICE_MARKET_DATA } from '../provider/adapter';
import { base64Json } from '../provider/server';

describe('VEIL demo provider + agent flow', () => {
  let sim: SimHandles;
  before(async () => {
    sim = await startSim();
  });
  after(async () => {
    await sim.close();
  });
  const agentOf = () => sim.agent;
  const providerOf = () => sim.provider;
  const AMOUNT = () => sim.provider.opts.pricePerCallAtoms;

  it('1. unpaid request -> 402 Payment Required', async () => {
    const res = await fetch(`${sim.baseUrl}/api/market-data`, { headers: { symbol: 'ETH/USD' } as never });
    assert.equal(res.status, 402);
    const paymentRequired = res.headers.get('payment-required');
    assert.ok(paymentRequired, 'missing PAYMENT-REQUIRED header');
    const decoded = JSON.parse(Buffer.from(paymentRequired, 'base64').toString('utf8'));
    assert.equal(decoded.x402Version, 2);
    assert.ok(decoded.accepts.length >= 1);
    assert.equal(decoded.error, 'X-PAYMENT header is required');
  });

  it('2. successful payment -> 200 + market data + fulfillment recorded', async () => {
    const agent = agentOf();
    const orderId = 201n;
    const purchase = await agent.purchaseMarketData({ orderId, amount: AMOUNT(), privateKey: AGENT_PRIVATE_KEY, symbol: 'BTC/USD' });
    assert.equal(purchase.status, 200);
    const body = purchase.body as { symbol: string; price: string };
    assert.equal(body.symbol, 'BTC/USD');
    assert.equal(typeof body.price, 'string');
    assert.ok(purchase.headers.get('payment-response'));
    const status = (await agent.orderStatus(orderId)) as {
      paymentVerified: boolean;
      fulfillmentVerified: boolean;
      escrowStatus: string;
    };
    assert.equal(status.paymentVerified, true);
    assert.equal(status.fulfillmentVerified, true);
    assert.equal(status.escrowStatus, 'Locked'); // not yet settled
  });

  it('3. invalid payment -> rejected', async () => {
    const agent = agentOf();
    const orderId = 301n;
    // Tamper: wrong signer (not the recorded agent) -> ECRECOVER mismatch.
    const res = await fetch(`${sim.baseUrl}/api/market-data`, {
      headers: {
        'x-payment': base64Json({
          x402Version: 2,
          accepted: {
            scheme: 'veil-exact',
            network: 'eip155:11155111',
            amount: AMOUNT().toString(),
            asset: `0x${'00'.repeat(20)}`,
            payTo: PROVIDER,
            maxTimeoutSeconds: 120,
            extra: { serviceId: SERVICE_MARKET_DATA },
          },
          payload: {
            orderId: orderId.toString(),
            agent: '0x' + 'BB'.repeat(20), // different from recorded payer
            provider: PROVIDER,
            serviceId: SERVICE_MARKET_DATA,
            amount: AMOUNT().toString(),
            nonce: `${Date.now()}`,
            transactionRef: SERVICE_MARKET_DATA,
            signature: AGENT_PRIVATE_KEY, // even if it were a valid sig, signer != agent
          },
        }),
      },
    });
    assert.ok([402, 422].includes(res.status));
    const data = (await res.json()) as { error: string };
    assert.match(data.error, /recover|not recorded|invalid signature/);
    // Ensure no fulfillment was recorded.
    const status = (await agent.orderStatus(orderId)) as { fulfillmentVerified: boolean };
    assert.equal(status.fulfillmentVerified, false);
  });

  it('3b. malformed X-PAYMENT -> rejected 400/402', async () => {
    const res = await fetch(`${sim.baseUrl}/api/market-data`, { headers: { 'x-payment': '!!!not-base64-json!!!' } });
    assert.ok([400, 402].includes(res.status));
  });

  it('4. fulfillment -> deterministic result hash recorded (FulfillmentReceipt mirror)', async () => {
    const agent = agentOf();
    const provider = providerOf();
    const orderId = 401n;
    await agent.purchaseMarketData({ orderId, amount: AMOUNT(), privateKey: AGENT_PRIVATE_KEY });
    const status = (await agent.orderStatus(orderId)) as { fulfillmentVerified: boolean; serviceId: string };
    assert.equal(status.fulfillmentVerified, true);
    assert.equal(status.serviceId.toLowerCase(), SERVICE_MARKET_DATA.toLowerCase());

    // Determinism: same inputs -> same result hash.
    const h1 = provider.adapter.computeResultHash({
      orderId,
      serviceId: SERVICE_MARKET_DATA,
      provider: PROVIDER,
      payloadRef: '0x' + 'aa'.repeat(32),
    });
    const h2 = provider.adapter.computeResultHash({
      orderId,
      serviceId: SERVICE_MARKET_DATA,
      provider: PROVIDER,
      payloadRef: '0x' + 'aa'.repeat(32),
    });
    assert.equal(h1, h2);
  });

  it('5. missing fulfillment -> settlement blocked', async () => {
    const agent = agentOf();
    const orderId = 501n;
    // Record payment but do NOT proceed to fulfillment (never purchases).
    await agent.recordAgentPayment({ orderId, amount: AMOUNT(), serviceId: SERVICE_MARKET_DATA, agent: AGENT });
    const settle = await agent.settle(orderId, OPERATOR);
    assert.equal(settle.ok, false);
    assert.match(settle.error ?? '', /FulfillmentNotVerified/);
    const status = (await agent.orderStatus(orderId)) as { escrowStatus: string };
    assert.equal(status.escrowStatus, 'Locked');
  });

  it('6. escrow release on settlement', async () => {
    const agent = agentOf();
    const provider = providerOf();
    const orderId = 601n;
    await agent.purchaseMarketData({ orderId, amount: AMOUNT(), privateKey: AGENT_PRIVATE_KEY });
    const settle = await agent.settle(orderId, OPERATOR);
    assert.equal(settle.ok, true);
    const status = (await agent.orderStatus(orderId)) as { escrowStatus: string };
    assert.equal(status.escrowStatus, 'Released');
    assert.equal(provider.ledger.escrowStatus(orderId), 2); // EscrowStatus.Released
  });

  it('6b. settlement requires operator authorization', async () => {
    const agent = agentOf();
    const orderId = 611n;
    await agent.purchaseMarketData({ orderId, amount: AMOUNT(), privateKey: AGENT_PRIVATE_KEY });
    const settle = await agent.settle(orderId, '0x' + '99'.repeat(20));
    assert.equal(settle.ok, false);
    assert.match(settle.error ?? '', /Unauthorized/);
  });

  it('7. refund when fulfillment is missing', async () => {
    const agent = agentOf();
    const provider = providerOf();
    const orderId = 701n;
    await agent.recordAgentPayment({ orderId, amount: AMOUNT(), serviceId: SERVICE_MARKET_DATA, agent: AGENT });
    const refund = await agent.refund(orderId, OPERATOR);
    assert.equal(refund.ok, true, JSON.stringify(refund));
    const status = (await agent.orderStatus(orderId)) as { escrowStatus: string };
    assert.equal(status.escrowStatus, 'Refunded');
    assert.equal(provider.ledger.escrowStatus(orderId), 3); // EscrowStatus.Refunded
  });
});