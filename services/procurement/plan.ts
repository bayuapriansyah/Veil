/**
 * Deterministic rule-based procurement planner.
 *
 * Produces the SAME 9-step plan for a purchase every time:
 *
 *   1. searchProviders(serviceId)      — eligible discovery (reputation >= 3)
 *   2. getProviderDetails(provider)     — pick the best provider
 *   3. checkReputation(provider)        — must be >= 3
 *   4. checkMandate(serviceId)          — mandate covers the service
 *   5. checkBudget(amount)              — remaining >= amount
 *   6. requestService(provider, …)      — reserve a payment offer
 *   7. checkBudget(amount)              — re-validate ledger before paying
 *   8. makePayment(orderId)             — the ONLY payment path
 *   9. checkMandate(serviceId)          — post-purchase: spent updated, mandate active
 *
 * Non-purchase or privileged intents (settle, refund, revoke…) are rejected
 * before any step is produced: the agent never tries to settle or manage the
 * mandate that governs it.
 */
import { SERVICE_COMPUTE, SERVICE_MARKET_DATA } from '../provider/adapter';
import { ProcurementShop } from './shop';
import { ProcurementPlan, PlanStep, ToolName } from './types';
import { ProcurementPolicyError } from './tools';

/**
 * Business-intent parser. Deterministically decides whether a task is a
 * purchase the mandate could permit, and refuses settlement/mandate intents.
 */
export function parsePurchaseIntent(task: string): { serviceId: string; symbol?: string } {
  const t = task.toLowerCase();
  const forbidden = [
    /settle/i, /refund/i, /revoke/i, /increase (the )?budget/i, /set ?budget/i,
    /modify (the )?mandate/i, /mark .*verified/i, /deploy/i, /withdraw/i, /transfer (funds|to me)/i,
  ];
  for (const re of forbidden) {
    if (re.test(t)) {
      throw new ProcurementPolicyError(
        `non-purchase request "${task}" — the agent cannot settle, refund, revoke, or change budgets/mandates`,
      );
    }
  }
  if (/\bcompute\b/.test(t)) return { serviceId: SERVICE_COMPUTE };
  return { serviceId: SERVICE_MARKET_DATA, symbol: extractSymbol(t) };
}

export function buildProcurementPlan(task: string, shop: ProcurementShop): ProcurementPlan {
  const intent = parsePurchaseIntent(task);
  const { serviceId, symbol } = intent;

  const eligible = shop.searchProviders(serviceId);
  if (eligible.length === 0) {
    throw new ProcurementPolicyError(
      `no eligible provider offers service ${serviceId} (reputation >= 3, offered in catalog)`,
    );
  }
  // Best provider: highest reputation, then lowest price.
  const best = eligible.reduce((a, b) => {
    if (b.reputation !== a.reputation) return b.reputation > a.reputation ? b : a;
    return b.pricePerCallAtoms < a.pricePerCallAtoms ? b : a;
  });
  const amountAtoms = best.pricePerCallAtoms;
  const amountStr = amountAtoms.toString();
  const orderIdStr = shop.reserveOrderId().toString();

  const steps: PlanStep[] = [
    step(1, 'searchProviders', { serviceId }, 'discover eligible providers offering the service with reputation >= 3'),
    step(2, 'getProviderDetails', { provider: best.provider }, 'inspect the chosen provider before committing funds'),
    step(3, 'checkReputation', { provider: best.provider }, 'confirm score >= 3 on the authoritative ledger'),
    step(4, 'checkMandate', { serviceId }, 'confirm an active mandate covers this service'),
    step(5, 'checkBudget', { serviceId, amountAtoms: amountStr }, 'confirm remaining budget >= requested amount'),
    step(6, 'requestService', { provider: best.provider, serviceId, amountAtoms: amountStr, orderId: orderIdStr }, 'reserve a payment offer (no funds move yet)'),
    step(7, 'checkBudget', { serviceId, amountAtoms: amountStr }, 're-validate the ledger before any money moves'),
    step(8, 'makePayment', { orderId: orderIdStr, symbol: symbol ?? 'ETH/USD' }, 'pay the reserved offer — the ONLY payment path'),
    step(9, 'checkMandate', { serviceId }, 'post-purchase: spent incremented and mandate still active'),
  ];

  return { task, serviceId, steps };
}

function step(index: number, tool: ToolName, args: Record<string, string | number>, rationale: string): PlanStep {
  return { index, tool, args, rationale };
}

function extractSymbol(t: string): string | undefined {
  const m = t.match(/\b(ETH|BTC|SOL|AVAX|LINK|MATIC|USDC)\/(USD|USDT)\b/i);
  return m ? m[0].toUpperCase() : undefined;
}