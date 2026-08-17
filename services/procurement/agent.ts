/**
 * VEIL Phase 5 — the AI procurement agent engine.
 *
 * The agent purchases services the user's mandate permits, using the 7-tool
 * surface (5 read-only + requestService -> makePayment). It NEVER holds or
 * calls a privileged/settlement tool, and the SettlementLedger (not the agent)
 * remains the authority on what may be paid.
 *
 * Planner selection:
 *   - default: deterministic 9-step rule-based plan (`plan.ts`)
 *   - optional LLM: when `OPENAI_API_KEY` is present and not `sk-none`, one
 *     OpenAI tools call is attempted. On ANY config/parse error the agent fails
 *     soft to the deterministic planner — it never fabricates an outcome.
 *   - `openai` is imported dynamically (never at module load).
 */
import { ProcurementShop } from './shop';
import { TOOL_NAMES, ProcurementOutcome, ProcurementPlan, PlanStep, ToolCallRecord, ToolName } from './types';
import { AgentTool, assertSafeToolName, createAgentTools, ProcurementPolicyError, ToolResult } from './tools';
import { buildProcurementPlan, parsePurchaseIntent } from './plan';
import { SERVICE_MARKET_DATA } from '../provider/adapter';

export interface ProcurementAgentConfig {
  shop: ProcurementShop;
  /** Overrides process.env.OPENAI_API_KEY. */
  apiKey?: string;
  model?: string;
  /** Skip the LLM entirely and always use the deterministic planner. */
  forceDeterministic?: boolean;
}

const SYSTEM_PROMPT = `You are VEIL's procurement agent. You buy verified market-data services on
behalf of a user whose mandate is recorded on an authoritative settlement ledger.

Hard rules:
- Only the tools listed here exist. You MUST NOT invent tools, and you will
  never be offered a settlement, refund, revoke, budget, verify, or mandate
  tool. If a task asks for one, refuse it in your reasoning.
- The ONLY payment path is requestService -> makePayment. Never pay without a
  requestService offer.
- Returned tool calls are executed for real. Order them exactly as a careful
  purchase; the deterministic gate (reputation >= 3, active mandate, sufficient
  budget) applies to every call.
- Amounts are atom (string) values.`;

/** One OpenAI "tools" function definition per allowed tool. */
function openaiToolsSchema(): Array<Record<string, unknown>> {
  const defs: Array<{ name: ToolName; description: string; args: Record<string, string> }> = [
    { name: 'searchProviders', description: 'Discover providers offering a serviceId with reputation >= 3.', args: { serviceId: 'string' } },
    { name: 'getProviderDetails', description: 'Profile of one provider.', args: { provider: 'string' } },
    { name: 'checkMandate', description: 'Active mandates covering an (optional) serviceId.', args: {} },
    { name: 'checkBudget', description: 'Whether remaining ledger budget covers amountAtoms for serviceId.', args: { serviceId: 'string', amountAtoms: 'string' } },
    { name: 'checkReputation', description: 'Provider repute score (1-5) from the ledger.', args: { provider: 'string' } },
    { name: 'requestService', description: 'Reserve a payment offer (validates mandate + budget).', args: { provider: 'string', serviceId: 'string', amountAtoms: 'string' } },
    { name: 'makePayment', description: 'Pay a reserved offer (only after requestService).', args: { orderId: 'string' } },
  ];
  return defs.map((d) => ({
    type: 'function',
    function: {
      name: d.name,
      description: d.description,
      parameters: { type: 'object', properties: Object.fromEntries(Object.entries(d.args).map(([k, ty]) => [k, { type: ty === 'string' ? 'string' : 'string' }])), required: Object.keys(d.args) },
    },
  }));
}

export class ProcurementAgent {
  private tools: Map<ToolName, AgentTool>;
  private shop: ProcurementShop;
  config: ProcurementAgentConfig;

  constructor(config: ProcurementAgentConfig) {
    this.config = config;
    this.shop = config.shop;
    this.tools = createAgentTools(config.shop);
  }

  /** Run one tool synchronously-gated then asynchronously executed. */
  async runTool(name: string, args: Record<string, string | number> = {}): Promise<ToolResult> {
    assertSafeToolName(name); // privilege/unknown gate happens here
    const tool = this.tools.get(name as ToolName)!;
    return tool.run(args);
  }

  get toolNames(): readonly string[] {
    return TOOL_NAMES;
  }

  /**
   * Whether an LLM is eligible. `sk-none` disables it (envs often ship a
   * placeholder); presence of the key alone does not guarantee a network call
   * succeeds — that is the soft-fail path.
   */
  llmEnabled(): boolean {
    if (this.config.forceDeterministic) return false;
    const key = this.config.apiKey ?? process.env.OPENAI_API_KEY;
    return Boolean(key) && key !== 'sk-none';
  }

  /**
   * Produce a plan, trying the LLM first (when configured) and always falling
   * back to the deterministic planner. Never fabricates.
   */
  async plan(task: string): Promise<{ planner: 'llm' | 'deterministic'; plan: ProcurementPlan }> {
    // Intent gate: refuse non-purchase / privileged intents before ANY planning.
    parsePurchaseIntent(task);
    if (this.llmEnabled()) {
      try {
        const plan = await this.planWithLLM(task);
        return { planner: 'llm', plan };
      } catch (e) {
        // soft-fail: fall through to the deterministic rule-based planner
        void e;
      }
    }
    return { planner: 'deterministic', plan: buildProcurementPlan(task, this.shop) };
  }

  /** One full purchase run. */
  async run(task: string): Promise<ProcurementOutcome> {
    let planner: 'llm' | 'deterministic' = 'deterministic';
    let plan: ProcurementPlan;
    try {
      const result = await this.plan(task);
      planner = result.planner;
      plan = result.plan;
    } catch (e) {
      return {
        ok: false,
        task,
        planner,
        plan: { task, serviceId: SERVICE_MARKET_DATA, steps: [] },
        results: {},
        error: e instanceof Error ? e.message : String(e),
      };
    }
    return this.execute(plan, planner);
  }

  /** Execute a plan step-by-step, aborting on the first refusal/gate failure. */
  private async execute(plan: ProcurementPlan, planner: 'llm' | 'deterministic'): Promise<ProcurementOutcome> {
    const results: Record<string, ToolCallRecord> = {};
    let lastOfferOrderId: bigint | undefined;
    let orderId: bigint | undefined;
    let provider: string | undefined;
    let serviceId = plan.serviceId;
    let escrowStatus: string | undefined;
    let paymentVerified: boolean | undefined;
    let fulfillmentVerified: boolean | undefined;

    const fail = (error: string): ProcurementOutcome => ({
      ok: false,
      task: plan.task,
      planner,
      plan,
      results,
      error,
      orderId: orderId?.toString(),
      serviceId,
      provider,
      escrowStatus,
      paymentVerified,
      fulfillmentVerified,
    });

    for (const s of plan.steps) {
      let args = s.args;
      if (s.tool === 'makePayment' && args.orderId === undefined) {
        if (lastOfferOrderId === undefined) return fail('makePayment requires a prior requestService offer');
        args = { ...args, orderId: lastOfferOrderId.toString() };
      }

      let rec: ToolCallRecord;
      try {
        const r = await this.runTool(s.tool, args);
        rec = { args, ok: r.ok, data: r.data, error: r.error };
        results[s.index] = rec;

        if (!r.ok) return fail(`step ${s.index} ${s.tool}: ${r.error ?? 'failed'}`);

        const d = r.data as { [k: string]: unknown } | undefined;
        // Deterministic gates applied to observations (the ledger decides).
        if (s.tool === 'searchProviders') {
          const providers = (d as { providers?: unknown[] }).providers;
          if (!providers || providers.length === 0) {
            return fail(`no eligible provider (reputation >= 3) offers the requested service`);
          }
        }
        if (s.tool === 'checkReputation' && (d as { score?: number }).score! < 3) {
          return fail(`provider reputation ${(d as { score?: number }).score} < 3 (excluded)`);
        }
        if (s.tool === 'checkMandate' && (d as { mandates?: unknown[] }).mandates?.length === 0) {
          return fail(`no active mandate covers the requested service`);
        }
        if (s.tool === 'checkBudget' && (d as { affordable?: boolean }).affordable === false) {
          const b = d as { requiredAtoms?: string; remainingAtoms?: string };
          return fail(`budget breach: required ${b.requiredAtoms} atoms, remaining ${b.remainingAtoms} atoms`);
        }
        if (s.tool === 'requestService') {
          lastOfferOrderId = BigInt((d as { offer: { orderId: string } }).offer.orderId);
        }
        if (s.tool === 'makePayment') {
          const p = d as { orderId?: string; provider?: string; serviceId?: string; escrowStatus?: string; paymentVerified?: boolean; fulfillmentVerified?: boolean };
          orderId = BigInt(p.orderId ?? '');
          provider = p.provider;
          serviceId = p.serviceId ?? serviceId;
          escrowStatus = p.escrowStatus;
          paymentVerified = p.paymentVerified;
          fulfillmentVerified = p.fulfillmentVerified;
        }
      } catch (e) {
        rec = { args, ok: false, error: e instanceof Error ? e.message : String(e) };
        results[s.index] = rec;
        return fail(`step ${s.index} ${s.tool}: ${rec.error}`);
      }
    }

    return {
      ok: true,
      task: plan.task,
      planner,
      plan,
      results,
      orderId: orderId?.toString(),
      serviceId,
      provider,
      escrowStatus,
      paymentVerified,
      fulfillmentVerified,
    };
  }

  /**
   * One OpenAI tools call producing a plan. Throws on ANY config/parse error so
   * the caller can soft-fail to the deterministic planner.
   */
  private async planWithLLM(task: string): Promise<ProcurementPlan> {
    const key = this.config.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    if (!key || key === 'sk-none') throw new Error('OPENAI_API_KEY unset or sk-none');
    let openaiMod: any;
    try {
      // dynamic import via a non-literal specifier keeps 'openai' out of module
      // resolution when the package is not installed (soft-fail path).
      const specifier = 'openai';
      openaiMod = await import(specifier);
    } catch (e) {
      throw new Error(`openai package unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
    const OpenAI = openaiMod.default ?? openaiMod.OpenAI;
    const client = new OpenAI({ apiKey: key });
    const completion = await client.chat.completions.create({
      model: this.config.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Task: ${task}\n\nPlan the purchases you would make and emit the exact tool calls, in order, that implement them.` },
      ],
      tools: openaiToolsSchema() as never,
      tool_choice: 'auto',
    });
    const calls = (completion as any)?.choices?.[0]?.message?.tool_calls;
    if (!Array.isArray(calls) || calls.length === 0) {
      throw new Error('LLM produced no tool calls');
    }
    const serviceId = detectServiceId(task, calls);
    const steps = calls.map((c: any, i: number): PlanStep => {
      const nameRaw = String(c?.function?.name ?? '');
      assertSafeToolName(nameRaw); // privilege gate on LLM output too
      const args = parseArgs(c?.function?.arguments);
      return { index: i + 1, tool: nameRaw as ToolName, args, rationale: `LLM step ${i + 1}` };
    });
    return { task, serviceId, steps };
  }
}

function parseArgs(raw?: unknown): Record<string, string | number> {
  if (typeof raw !== 'string' || raw === '') return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('LLM tool args must be an object');
  const args: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'string' || typeof v === 'number') args[k] = v;
    else if (typeof v === 'bigint') args[k] = v.toString();
    else throw new Error(`tool arg ${k} must be a string or number`);
  }
  return args;
}

function detectServiceId(task: string, calls: unknown[]): string {
  for (const c of calls) {
    const name = (c as any)?.function?.name;
    if (name === 'searchProviders' || name === 'checkMandate' || name === 'requestService') {
      try {
        const args = parseArgs((c as any)?.function?.arguments);
        if (typeof args.serviceId === 'string') return args.serviceId;
      } catch {
        /* fall through */
      }
    }
  }
  return parsePurchaseIntent(task).serviceId;
}