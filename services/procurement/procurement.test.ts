/**
 * VEIL Phase 5 — AI procurement agent tests.
 *
 * Scenarios:
 *   1. success            — agent purchases market data within mandate
 *   2. budget breach      — remaining < amount -> refusal, no money moves
 *   3. service breach     — mandate does not cover the requested service
 *   4. revoked mandate    — mandate revoked -> refusal
 *   5. state authority    — the SettlementLedger (not the agent) gates release;
 *                           only the operator settles
 *   6. privilege guard    — the agent has no settlement/mandate/privilege tools
 *   7. deterministic fallback — LLM attempt fails soft -> deterministic works
 *
 * Order ids are deterministic (first reservation is 1189) so `requestService`
 * and ledger state stay easy to assert.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { SERVICE_COMPUTE, SERVICE_MARKET_DATA } from '../provider/adapter';
import { VeilLedger } from '../provider/types';
import { VeilProvider } from '../provider/server';
import { ProcurementAgent } from './agent';
import { createProcurementShop, OPERATOR, PROVIDER, ProcurementShop, ShopService } from './shop';
import { TOOL_NAMES } from './types';

export const PRICE = BigInt('1000000000000000'); // the provider's per-call price
export const AGENT_BUDGET = PRICE * 10n;

export interface ProcurementHarness {
  shop: ProcurementShop;
  agent: ProcurementAgent;
  provider: VeilProvider;
  ledger: VeilLedger;
  operator: string;
  close: () => Promise<void>;
}

export interface HarnessOptions {
  budgetAtoms?: bigint;
  mandateServiceId?: string;
  services?: ShopService[];
  reputation?: number;
  revoke?: boolean;
  providers?: Array<{ address: string; reputation?: number; services?: ShopService[] }>;
}

export async function createHarness(opts: HarnessOptions = {}): Promise<ProcurementHarness> {
  const providers = opts.providers ?? [{ address: PROVIDER, reputation: opts.reputation ?? 5, services: opts.services }];
  const { shop, close } = await createProcurementShop({ providers, operator: OPERATOR });
  const mandateServiceId = opts.mandateServiceId ?? SERVICE_MARKET_DATA;
  shop.createMandate({
    serviceId: mandateServiceId,
    budgetAtoms: opts.budgetAtoms ?? AGENT_BUDGET,
    owner: OPERATOR,
  });
  if (opts.revoke) {
    for (const { ledger } of shop.ledgers()) {
      for (const m of ledger.activeMandates()) ledger.revokeMandate(m.mandateId, OPERATOR);
    }
  }
  const agent = new ProcurementAgent({ shop });
  const provider = shop.providerOf(PROVIDER)!;
  return { shop, agent, provider, ledger: provider.ledger, operator: OPERATOR, close };
}

const COMPUTE_SERVICE: ShopService = {
  serviceId: SERVICE_COMPUTE,
  name: 'Compute Rentals',
  description: 'Wholesale compute, per-call',
  pricePerCallAtoms: PRICE * 2n,
};

describe('VEIL procurement agent', () => {
  it('1. success — purchases market data within mandate; debit lands on the ledger only at settlement', async () => {
    const h = await createHarness();
    try {
      const out = await h.agent.run('purchase market data for ETH/USD');
      assert.equal(out.ok, true, JSON.stringify(out.error ?? out));
      assert.equal(out.planner, 'deterministic');
      assert.equal(out.plan.steps.length, 9);
      assert.equal(out.orderId, '1189'); // deterministic seed: first reserved order
      assert.equal(out.serviceId, SERVICE_MARKET_DATA);
      assert.equal(out.provider, PROVIDER);
      assert.equal(out.paymentVerified, true);
      assert.equal(out.fulfillmentVerified, true);
      assert.equal(out.escrowStatus, 'Locked');

      // The purchase reserves exactly PRICE in escrow; budget is committed on release.
      const escrow = h.ledger.escrow(1189n)!;
      assert.equal(escrow.amount, PRICE);
      assert.equal(escrow.payer!.toLowerCase(), h.shop.agentAddress.toLowerCase());
      let mandate = h.ledger.findActiveMandate(OPERATOR, SERVICE_MARKET_DATA)!;
      assert.equal(mandate.spent, 0n); // nothing released yet — ledger still holds authority

      // Operator settlement moves the exact amount from budget to spent.
      const settle = await postOperator(h, '/api/settle', 1189n, h.operator);
      assert.equal(settle.ok, true, JSON.stringify(settle));
      mandate = h.ledger.findActiveMandate(OPERATOR, SERVICE_MARKET_DATA)!;
      assert.equal(mandate.spent, PRICE);
      assert.equal(mandate.budget - mandate.spent, AGENT_BUDGET - PRICE);
      assert.equal(await h.ledger.escrowStatus(1189n), 2); // Released
    } finally {
      await h.close();
    }
  });

  it('2. budget breach — refusal before requestService; no money moves', async () => {
    const h = await createHarness({ budgetAtoms: PRICE / 2n });
    try {
      const out = await h.agent.run('purchase market data');
      assert.equal(out.ok, false);
      assert.match(out.error ?? '', /budget breach/i);
      const requestService = out.plan.steps.find((s) => s.tool === 'requestService');
      assert.ok(requestService, 'plan should include requestService as the entry point');
      assert.equal(out.results[requestService!.index], undefined, 'requestService never ran');
      assert.equal(h.ledger.findActiveMandate(OPERATOR, SERVICE_MARKET_DATA)!.spent, 0n);
    } finally {
      await h.close();
    }
  });

  it('3. service breach — mandate covers market-data, not compute', async () => {
    const h = await createHarness({ services: [{ ...defaultMarketData(), pricePerCallAtoms: PRICE }, COMPUTE_SERVICE] });
    try {
      const out = await h.agent.run('purchase compute service');
      assert.equal(out.ok, false);
      assert.match(out.error ?? '', /mandate|covers/i);
      assert.equal(h.ledger.findActiveMandate(OPERATOR, SERVICE_COMPUTE), undefined);
      assert.equal(await h.ledger.escrowStatus(1189n), 0); // EscrowStatus.None — nothing reserved either
    } finally {
      await h.close();
    }
  });

  it('4. revoked mandate — refusal', async () => {
    const h = await createHarness({ revoke: true });
    try {
      const out = await h.agent.run('purchase market data');
      assert.equal(out.ok, false);
      assert.match(out.error ?? '', /mandate|covers/i);
      assert.equal(h.ledger.findActiveMandate(OPERATOR, SERVICE_MARKET_DATA), undefined);
    } finally {
      await h.close();
    }
  });

  it('5. state authority — the ledger (not the agent) gates escrow release', async () => {
    const h = await createHarness();
    try {
      const out = await h.agent.run('purchase market data');
      assert.equal(out.ok, true, JSON.stringify(out.error ?? out));
      const orderId = BigInt(out.orderId!);

      // The agent acted, but the ledger is still the authority:
      assert.equal(await h.ledger.escrowStatus(orderId), 1); // Locked
      assert.equal(await h.ledger.isPaymentVerified(orderId), true);
      assert.equal(await h.ledger.isFulfillmentVerified(orderId), true);

      // A stranger cannot settle — the escrow stays Locked.
      const stranger = await postOperator(h, '/api/settle', orderId, '0x' + '99'.repeat(20));
      assert.equal(stranger.ok, false);
      assert.match(stranger.error ?? '', /Unauthorized/i);
      assert.equal(await h.ledger.escrowStatus(orderId), 1); // still Locked

      // Only the operator can settle — via the /api/settle rail.
      const okSettle = await postOperator(h, '/api/settle', orderId, h.operator);
      assert.equal(okSettle.ok, true);
      assert.equal(await h.ledger.escrowStatus(orderId), 2); // Released
    } finally {
      await h.close();
    }
  });

  it('6. privilege guard — the agent has no settlement/mandate/privilege tools', async () => {
    const h = await createHarness();
    try {
      assert.deepEqual([...h.agent.toolNames].sort(), [...TOOL_NAMES].sort());
      for (const name of ['settleOrder', 'settle', 'releaseEscrow', 'revokeMandate', 'increaseBudget', 'setBudget', 'markPaymentVerified', 'markFulfillmentVerified', 'modifyMandate', 'deploy']) {
        await assert.rejects(async () => h.agent.runTool(name, {}), /not available to the agent/i, `expected ${name} to be rejected`);
      }
      await assert.rejects(async () => h.agent.runTool('getWeather', {}), /not available to the agent/i);

      // makePayment is the ONLY path into paying; it needs a requestService offer.
      const beforeOffer = await h.agent.runTool('makePayment', { orderId: '42' });
      assert.equal(beforeOffer.ok, false);
      assert.match(beforeOffer.error ?? '', /requestService/i);

      // Non-purchase / privileged intents are refused before any planning.
      const refuse = await h.agent.run('settle the last order and wire me the money');
      assert.equal(refuse.ok, false);
      assert.match(refuse.error ?? '', /non-purchase request|cannot settle|not available/i);
    } finally {
      await h.close();
    }
  });

  it('7. deterministic fallback — LLM attempt fails soft to the rule-based planner', async () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-softfail';
    try {
      const h = await createHarness();
      try {
        // openai is not installed: dynamic import fails -> soft fallback.
        const out = await h.agent.run('purchase market data');
        assert.equal(out.planner, 'deterministic');
        assert.equal(out.ok, true, JSON.stringify(out.error ?? out));

        // forceDeterministic respects the intent gate and still buys.
        const forced = new ProcurementAgent({ shop: h.shop, forceDeterministic: true });
        const out2 = await forced.run('purchase market data');
        assert.equal(out2.planner, 'deterministic');
        assert.equal(out2.ok, true, JSON.stringify(out2.error ?? out2));
      } finally {
        await h.close();
      }
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });
});

function defaultMarketData(): ShopService {
  return { serviceId: SERVICE_MARKET_DATA, name: 'Market Data Feed', description: 'Real-time market data (per-call)', pricePerCallAtoms: PRICE };
}

async function postOperator(h: ProcurementHarness, path: string, orderId: bigint, operator: string): Promise<{ ok: boolean; error?: string }> {
  const base = `http://127.0.0.1:${h.shop.handleOf(PROVIDER)!.port}`;
  const res = await fetch(`${base}${path}/${orderId}`, {
    method: 'POST',
    headers: { 'x-operator': operator },
  });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}