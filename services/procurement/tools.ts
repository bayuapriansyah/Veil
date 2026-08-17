/**
 * The agent's tool surface — EXACTLY 7 tools and nothing more.
 *
 *   read-only (5): searchProviders, getProviderDetails, checkMandate,
 *                  checkBudget, checkReputation
 *   state-changing (2): requestService -> makePayment  (the ONLY payment path)
 *
 * There is deliberately NO privileged tool: the agent cannot increase budgets,
 * revoke/modify mandates, bypass escrow, mark payment/fulfillment verified, or
 * settle. Those capabilities stay on the SettlementLedger / operator.
 *
 * Args are JSON-safe (strings/numbers only). BigInt atoms travel as strings so
 * they never hit the JSON serialization bug.
 */
import { atomsOf, ProcurementShop } from './shop';
import { TOOL_NAMES, PRIVILEGED_RESERVED, PurchaseOffer, ToolName } from './types';

/** Raised when a task or tool call is outside what the agent is allowed to do. */
export class ProcurementPolicyError extends Error {}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface AgentTool {
  name: ToolName;
  description: string;
  run: (args: Record<string, string | number>) => Promise<ToolResult>;
}

/**
 * The hard gate. Any tool name that is not one of the 7 allowed tools is
 * rejected; anything that smells like settlement/mandate privilege is rejected
 * with an explicit "not available to the agent" message.
 */
export function assertSafeToolName(name: string): void {
  if ((TOOL_NAMES as readonly string[]).includes(name)) return;
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const privileged = PRIVILEGED_RESERVED.some((p) => p.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized)
    || /^(settle|refund|release|revoke|mark|verify|increase|modify|deploy|setbudget|deleteincome)/.test(normalized);
  if (privileged) {
    throw new ProcurementPolicyError(
      `privileged settlement/mandate tool "${name}" is not available to the agent`,
    );
  }
  throw new ProcurementPolicyError(`unknown tool "${name}" is not available to the agent`);
}

export function isAllowedTool(name: string): boolean {
  try {
    assertSafeToolName(name);
    return true;
  } catch {
    return false;
  }
}

export function createAgentTools(shop: ProcurementShop): Map<ToolName, AgentTool> {
  const tools = new Map<ToolName, AgentTool>();

  tools.set('searchProviders', {
    name: 'searchProviders',
    description: 'Discover providers that offer a serviceId with reputation >= 3.',
    run: async (args) => {
      const serviceId = required(args.serviceId, 'serviceId');
      const providers = shop.searchProviders(serviceId).map((o) => ({
        provider: o.provider,
        serviceId: o.serviceId,
        name: o.name,
        description: o.description,
        reputation: o.reputation,
        pricePerCallAtoms: o.pricePerCallAtoms.toString(),
      }));
      return { ok: true, data: { providers } };
    },
  });

  tools.set('getProviderDetails', {
    name: 'getProviderDetails',
    description: 'Profile of one provider: services, reputation, operator, active mandate count.',
    run: async (args) => {
      const provider = required(args.provider, 'provider');
      const profile = shop.providerProfile(provider);
      if (!profile) return { ok: false, error: 'ProviderNotKnown' };
      return {
        ok: true,
        data: {
          ...profile,
          services: profile.services.map((s) => ({ ...s, pricePerCallAtoms: s.pricePerCallAtoms.toString() })),
        },
      };
    },
  });

  tools.set('checkMandate', {
    name: 'checkMandate',
    description: 'Show the agent whether an active mandate covers a service (read mirror of the ledger).',
    run: async (args) => {
      const serviceId = args.serviceId ? String(args.serviceId) : undefined;
      const mandateId = args.mandateId ? Number(args.mandateId) : undefined;
      let mandates = shop.activeMandates();
      if (serviceId) {
        mandates = mandates.filter((m) => m.serviceId.toLowerCase() === serviceId.toLowerCase());
      }
      if (mandateId !== undefined) {
        mandates = mandates.filter((m) => m.mandateId === mandateId);
      }
      return { ok: true, data: { mandates } };
    },
  });

  tools.set('checkBudget', {
    name: 'checkBudget',
    description: 'Check that remaining budget on the authoritative ledger covers an amount for a service.',
    run: async (args) => {
      const serviceId = required(args.serviceId, 'serviceId');
      const requiredAtoms = atomsOf(args.amountAtoms);
      let remainingAtoms = 0n;
      let mandateId: number | undefined;
      for (const { ledger } of shop.ledgers()) {
        const m = ledger.activeMandateOf(shop.operator, serviceId);
        if (m) {
          const remaining = m.budget - m.spent;
          if (remaining > remainingAtoms) {
            remainingAtoms = remaining;
            mandateId = m.mandateId;
          }
        }
      }
      const affordable = remainingAtoms >= requiredAtoms;
      return {
        ok: true,
        data: {
          serviceId,
          affordable,
          requiredAtoms: requiredAtoms.toString(),
          remainingAtoms: remainingAtoms.toString(),
          mandateId,
        },
      };
    },
  });

  tools.set('checkReputation', {
    name: 'checkReputation',
    description: 'Read a provider repute score from the ledger (1-5, 0 unrated, < 3 excluded).',
    run: async (args) => {
      const provider = required(args.provider, 'provider');
      return { ok: true, data: { provider, score: shop.reputationOf(provider) } };
    },
  });

  tools.set('requestService', {
    name: 'requestService',
    description: 'Request a payment offer for a service. Validates mandate + budget on the authoritative ledger.',
    run: async (args) => {
      const provider = required(args.provider, 'provider');
      const serviceId = required(args.serviceId, 'serviceId');
      const offer = await buildOffer(shop, provider, serviceId, {
        amountAtoms: args.amountAtoms ? String(args.amountAtoms) : undefined,
        orderId: args.orderId ? BigInt(String(args.orderId)) : undefined,
      });
      return {
        ok: true,
        data: {
          offer: {
            orderId: offer.orderId.toString(),
            provider: offer.provider,
            serviceId: offer.serviceId,
            serviceName: offer.serviceName,
            amountAtoms: offer.amountAtoms.toString(),
            payTo: offer.requirement.payTo,
            scheme: offer.requirement.scheme,
            resource: offer.requirement.resource,
          },
        },
      };
    },
  });

  tools.set('makePayment', {
    name: 'makePayment',
    description: 'Pay a previously requested offer. Only valid after requestService succeeded.',
    run: async (args) => {
      const orderId = BigInt(required(args.orderId, 'orderId'));
      const offer = shop.takeOffer(orderId);
      if (!offer) {
        return { ok: false, error: 'NoActiveOffer: call requestService first (the only payment path)' };
      }
      // Re-validate against CURRENT ledger state: the ledger, not the offer, is authority.
      const handle = shop.handleOf(offer.provider);
      if (!handle) return { ok: false, error: 'ProviderNotKnown' };
      const mandate = handle.provider.ledger.activeMandateOf(shop.operator, offer.serviceId);
      if (!mandate) return { ok: false, error: 'MandateNotActiveAtPayment' };
      if (mandate.budget - mandate.spent < offer.amountAtoms) {
        return { ok: false, error: 'BudgetNotCompliantAtPayment' };
      }
      const result = await shop.makePayment({
        offer,
        symbol: args.symbol ? String(args.symbol) : undefined,
      });
      if (!result.ok) return { ok: false, error: result.error };
      return {
        ok: true,
        data: {
          orderId: result.orderId!.toString(),
          provider: result.provider,
          serviceId: result.serviceId,
          status: result.status,
          paymentVerified: result.paymentVerified,
          fulfillmentVerified: result.fulfillmentVerified,
          escrowStatus: result.escrowStatus,
        },
      };
    },
  });

  return tools;
}

/**
 * Core validation + offer construction for requestService. This is where the
 * ledger's mandate state decides what is purchasable:
 *   allowed services = mandate.serviceId
 *   budget          = budget - spent
 *   validity        = active, not revoked, not expired, serviceId match,
 *                     remaining budget >= amount
 */
async function buildOffer(
  shop: ProcurementShop,
  provider: string,
  serviceId: string,
  opts: { amountAtoms?: string; orderId?: bigint },
): Promise<PurchaseOffer> {
  const offering = shop.offering(provider, serviceId);
  if (!offering) throw new ProcurementPolicyError('ServiceNotOfferedByProvider');
  if (offering.reputation < 3) throw new ProcurementPolicyError('ProviderExcludedByReputation');

  const handle = shop.handleOf(provider);
  if (!handle) throw new ProcurementPolicyError('ProviderNotKnown');

  const mandate = handle.provider.ledger.activeMandateOf(shop.operator, serviceId);
  if (!mandate) throw new ProcurementPolicyError('MandateDoesNotCoverService');

  const price = offering.pricePerCallAtoms;
  const requested = opts.amountAtoms !== undefined ? BigInt(opts.amountAtoms) : price;
  if (requested < price) throw new ProcurementPolicyError('AmountBelowRequirement');
  if (mandate.budget - mandate.spent < requested) throw new ProcurementPolicyError('BudgetNotCompliant');

  let requirement;
  try {
    requirement = await shop.discoverRequirement(provider);
  } catch (e: any) {
    throw new ProcurementPolicyError(`discovery failed: ${e?.message ?? e}`);
  }

  const orderId = opts.orderId ?? shop.reserveOrderId();
  const offer: PurchaseOffer = {
    orderId,
    provider,
    serviceId,
    serviceName: offering.name,
    amountAtoms: requested,
    requirement: requirement.accepts.find((a) => a.scheme === 'veil-exact') ?? requirement.accepts[0],
  };
  shop.registerOffer(offer);
  return offer;
}

function required(value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') {
    throw new ProcurementPolicyError(`missing required arg: ${label}`);
  }
  return String(value);
}