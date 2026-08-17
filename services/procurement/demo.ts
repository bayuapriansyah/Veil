/**
 * VEIL Phase 5 demo — the AI procurement agent buying market data.
 *
 * Run: npm run demo:procurement
 *
 * Story:
 *   1. agent discovers eligible providers (reputation >= 3) and picks the best
 *   2. it checks mandate + remaining budget on the authoritative ledger
 *   3. requestService reserves a payment offer
 *   4. makePayment pays through the real x402/VEIL HTTP rail
 *   5. escrow stays Locked — only the operator (the user) can settle
 *   6. a privileged intent ("settle", "raise my budget") is refused outright
 */
import { SERVICE_COMPUTE, SERVICE_MARKET_DATA } from '../provider/adapter';
import { ProcurementAgent } from './agent';
import { createProcurementShop, OPERATOR, PROVIDER, ShopService } from './shop';

const PRICE = BigInt('1000000000000000'); // 0.001 ether-equivalent per call

const PRIMARY: ShopService = { serviceId: SERVICE_MARKET_DATA, name: 'Market Data Feed', description: 'Real-time market data (per-call)', pricePerCallAtoms: PRICE };
const COMPUTE: ShopService = { serviceId: SERVICE_COMPUTE, name: 'Compute Rentals', description: 'Wholesale compute (per-call)', pricePerCallAtoms: PRICE * 2n };

const SECONDARY_PROVIDER = '0x' + '44'.repeat(20);
const LOW_REP_PROVIDER = '0x' + '55'.repeat(20);

export async function runProcurementDemo(): Promise<void> {
  const budgetAtoms = PRICE * 20n;
  const { shop, close } = await createProcurementShop({
    operator: OPERATOR,
    providers: [
      { address: PROVIDER, reputation: 5, services: [PRIMARY] },
      { address: SECONDARY_PROVIDER, reputation: 5, services: [{ ...PRIMARY, pricePerCallAtoms: PRICE * 3n }] },
      { address: LOW_REP_PROVIDER, reputation: 2, services: [PRIMARY] }, // excluded (score < 3)
    ],
  });

  shop.createMandate({ serviceId: SERVICE_MARKET_DATA, budgetAtoms, owner: OPERATOR });
  const agent = new ProcurementAgent({ shop });

  console.log('=== VEIL Phase 5: AI procurement agent ===');
  console.log(`operator (mandate owner) : ${OPERATOR}`);
  console.log(`agent wallet             : ${shop.agentAddress}`);
  console.log(`mandate budget           : ${budgetAtoms} atoms (market-data only)`);

  console.log('\n[1] Discovery — who can sell market data?');
  const eligible = shop.searchProviders(SERVICE_MARKET_DATA);
  for (const o of eligible) {
    console.log(`  -> ${o.provider}  score=${o.reputation}  price=${o.pricePerCallAtoms}  "${o.name}"`);
  }
  console.log(`  (${LOW_REP_PROVIDER} excluded: reputation 2 < 3)`);

  console.log('\n[2] Agent runs the deterministic 9-step plan:');
  const out = await agent.run('purchase market data (ETH/USD)');
  for (const step of out.plan.steps) {
    console.log(`  ${step.index}. ${step.tool}(${JSON.stringify(step.args)})  — ${step.rationale}`);
  }

  console.log('\n[3] Outcome:');
  console.log(`  ok               = ${out.ok}`);
  console.log(`  planner          = ${out.planner}`);
  console.log(`  orderId          = ${out.orderId}`);
  console.log(`  provider         = ${out.provider}`);
  console.log(`  paymentVerified  = ${out.paymentVerified}`);
  console.log(`  fulfillmentVrfy  = ${out.fulfillmentVerified}`);
  console.log(`  escrowStatus     = ${out.escrowStatus} (agent cannot release — only the operator can)`);

  console.log('\n[4] Operator settles the escrow (the ledger is the authority):');
  const base = `http://127.0.0.1:${shop.handleOf(PROVIDER)!.port}`;
  const settle = await fetch(`${base}/api/settle/${out.orderId}`, {
    method: 'POST',
    headers: { 'x-operator': OPERATOR },
  });
  console.log(`  -> ${JSON.stringify(await settle.json())}`);
  const status = await fetch(`${base}/api/orders/${out.orderId}`);
  const order = await status.json();
  console.log(`  -> order detail  = ${JSON.stringify(order)}`);
  console.log(`  -> mandate spent = ${shop.ledgerOf(PROVIDER)!.activeMandateOf(OPERATOR, SERVICE_MARKET_DATA)!.spent} atoms`);

  console.log('\n[5] Privileged intent is refused:');
  const refused = await agent.run('settle the last order and send me the money');
  console.log(`  "settle the last order…" -> ok=${refused.ok} error="${refused.error}"`);

  console.log('\n[6] Budget breach is refused before any money moves:');
  const { shop: brokeShop, close: closeBroke } = await createProcurementShop({ operator: OPERATOR, providers: [{ address: PROVIDER, reputation: 5, services: [PRIMARY] }] });
  brokeShop.createMandate({ serviceId: SERVICE_MARKET_DATA, budgetAtoms: PRICE / 2n, owner: OPERATOR });
  const brokeAgent = new ProcurementAgent({ shop: brokeShop });
  const breach = await brokeAgent.run('purchase market data');
  const spent = brokeShop.ledgerOf(PROVIDER)!.activeMandateOf(OPERATOR, SERVICE_MARKET_DATA)!.spent;
  console.log(`  budget=${PRICE / 2n} requested=${PRICE} -> ok=${breach.ok} error="${breach.error}"`);
  console.log(`  spent = ${spent} (nothing was charged)`);
  await closeBroke();

  await close();
}

if (require.main === module) {
  runProcurementDemo().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}