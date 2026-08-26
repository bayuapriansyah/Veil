/**
 * Agent B — A2A executor.
 *
 * Receives delegated tasks from Agent A via the A2A protocol, purchases
 * services from Shop C using its own wallet (on-chain AgentPayment +
 * FulfillmentReceipt on Sepolia), and returns the result.
 *
 * CRITICAL: Verifies Agent A's signature before executing. This proves the
 * delegation message came from a specific on-chain agent, not an impersonator.
 *
 * Agent B is BOTH:
 *   - Provider for A→B (can sign FulfillmentReceipt as onlyProvider)
 *   - Agent for B→C (signs AgentPayment on Sepolia)
 */
import { Wallet, keccak256, toUtf8Bytes, verifyMessage } from 'ethers';
import { AgentExecutor, RequestContext, ExecutionEventBus, AgentEvent } from '@a2a-js/sdk/server';
import { Part, Role, TaskState } from '@a2a-js/sdk';
import { createProcurementShop, OPERATOR } from '../procurement/shop';
import { ProcurementAgent } from '../procurement/agent';
import { SERVICE_MARKET_DATA } from '../provider/adapter';
import { recordAgentPayment, recordFulfillment } from '../attestation/record';

/** Build a v1 SDK text Part. */
function textPart(value: string): Part {
  return { content: { $case: 'text', value }, metadata: undefined, filename: '', mediaType: 'text/plain' };
}

/** Build a complete v1 Message carrying one text part from the agent. */
function agentMessage(text: string, ctx: { taskId: string; contextId: string }) {
  return {
    role: Role.ROLE_AGENT,
    parts: [textPart(text)],
    metadata: undefined,
    messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    contextId: ctx.contextId,
    taskId: ctx.taskId,
    extensions: [],
    referenceTaskIds: [],
  };
}

/** Extract concatenated text from a v1 Part array. */
export function extractText(parts: readonly Part[] | undefined | null): string {
  return (parts ?? [])
    .map((p) => (p.content && p.content.$case === 'text' ? p.content.value : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
}

/** Build a complete v1 Task event for the bus. */
function taskEvent(
  id: string,
  contextId: string,
  state: TaskState,
  message: ReturnType<typeof agentMessage>,
) {
  return {
    id,
    contextId,
    status: { state, timestamp: new Date().toISOString(), message },
    artifacts: [],
    history: [],
    metadata: undefined,
  };
}

const AGENT_B_PRIVATE_KEY = process.env.AGENT_B_WALLET_PRIVATE_KEY ?? '';
const AGENT_B_ADDRESS = AGENT_B_PRIVATE_KEY ? new Wallet(AGENT_B_PRIVATE_KEY).address : '';
const PRICE_ATOMS = BigInt('1000000000000000'); // 0.001 ETH

/**
 * Delegation replay guard: signatures older/newer than this are rejected.
 * Prevents a captured delegation from being replayed hours later.
 */
export const DELEGATION_MAX_AGE_MS = 5 * 60 * 1000;

export interface AgentBResult {
  ok: boolean;
  orderId?: string;
  provider?: string;
  serviceId?: string;
  error?: string;
  /** On-chain B→C AgentPayment tx hash (Sepolia). */
  bToCPaymentTx?: string;
  /** Whether the B→C AgentPayment actually broadcast (soft-fail honesty flag). */
  bToCPaymentRecorded?: boolean;
  /** On-chain A→B FulfillmentReceipt tx hash (Sepolia, provider-signed). */
  aToBFulfillmentTx?: string;
  /** Whether the A→B FulfillmentReceipt actually broadcast (honesty flag). */
  aToBFulfillmentRecorded?: boolean;
  /** Agent A's verified wallet address (from signature). */
  verifiedAgent?: string;
}

/**
 * Verify Agent A's delegation signature.
 * Returns the verified agent address if valid, or null if invalid.
 *
 * The signed payload must match: { type, orderId, agent, task, timestamp }
 * and must be signed by the agent address claimed in the payload.
 */
/**
 * Verify Agent A's delegation signature.
 * Returns the verified agent address if valid, or null if invalid.
 *
 * Checks (all must pass):
 *   1. Payload type is 'a2a-delegation' with agent/orderId/timestamp present
 *   2. Timestamp is within DELEGATION_MAX_AGE_MS (replay guard)
 *   3. Signed fields match the transmitted metadata (orderId, task, agent)
 *   4. EIP-191 signature over keccak256(payload) recovers to the claimed agent
 */
export function verifyDelegationSignature(
  payload: string,
  signature: string,
  expected?: { orderId?: string; task?: string },
): string | null {
  try {
    const parsed = JSON.parse(payload);
    if (parsed.type !== 'a2a-delegation') return null;
    if (!parsed.agent || !parsed.orderId || !parsed.timestamp) return null;

    // Replay guard: reject delegations outside the freshness window.
    const age = Math.abs(Date.now() - Number(parsed.timestamp));
    if (!Number.isFinite(age) || age > DELEGATION_MAX_AGE_MS) return null;

    // The signed material must match what was actually transmitted.
    if (expected?.orderId && String(parsed.orderId) !== String(expected.orderId)) return null;
    if (expected?.task && parsed.task !== expected.task) return null;

    // Recover the signer from the signed hash (ethers v6 standalone API).
    const payloadHash = keccak256(toUtf8Bytes(payload));
    const recoveredAddress = verifyMessage(payloadHash, signature);

    // The recovered address must match the claimed agent address
    if (recoveredAddress.toLowerCase() !== String(parsed.agent).toLowerCase()) return null;

    return String(parsed.agent);
  } catch {
    return null;
  }
}

/**
 * Execute a delegated task: Agent B purchases from Shop C using its own wallet,
 * then fulfills the A→B order on-chain (signs as provider).
 */
export async function executeDelegatedTask(
  task: string,
  aToBOrderId: bigint,
  aToBAgent: string,
): Promise<AgentBResult> {
  if (!AGENT_B_PRIVATE_KEY) {
    return { ok: false, error: 'AGENT_B_WALLET_PRIVATE_KEY not set' };
  }

  // Agent B has its own shop with Shop C as the provider.
  const agentBWallet = new Wallet(AGENT_B_PRIVATE_KEY);
  const { shop, close } = await createProcurementShop({
    operator: OPERATOR,
    agentPrivateKey: AGENT_B_PRIVATE_KEY,
    agentAddress: agentBWallet.address,
    orderIdSeed: 700_000n, // reserved for Agent B
    providers: [
      // Shop C: the provider Agent B buys from
      {
        address: '0x' + '66'.repeat(20),
        reputation: 5,
        services: [{
          serviceId: SERVICE_MARKET_DATA,
          name: 'Shop C Market Data',
          description: 'Data feed from Shop C (fulfilled by Agent B)',
          pricePerCallAtoms: PRICE_ATOMS,
        }],
      },
    ],
  });

  try {
    // Create a mandate for Agent B
    shop.createMandate({
      serviceId: SERVICE_MARKET_DATA,
      budgetAtoms: PRICE_ATOMS * 10n,
      owner: OPERATOR,
    });

    // Run the procurement agent (Agent B buys from Shop C)
    const agent = new ProcurementAgent({ shop, forceDeterministic: true });
    const outcome = await agent.run(task);

    if (!outcome.ok || !outcome.orderId) {
      return { ok: false, error: outcome.error ?? 'Agent B procurement failed' };
    }

    const bToCOrderId = BigInt(outcome.orderId);
    const bToCProvider = outcome.provider!;
    const bToCServiceId = outcome.serviceId!;

    // Record B→C AgentPayment on Sepolia (signed by Agent B's wallet = agent)
    const bToCPayment = await recordAgentPayment({
      orderId: bToCOrderId,
      provider: bToCProvider,
      amount: PRICE_ATOMS,
      serviceId: bToCServiceId,
      transactionRef: keccak256(toUtf8Bytes(`${bToCOrderId}`)),
    }, AGENT_B_PRIVATE_KEY);

    // Settle on the mirror ledger
    const handle = shop.handleOf(bToCProvider);
    handle?.provider.settle(bToCOrderId, OPERATOR);

    // Record A→B FulfillmentReceipt on Sepolia (signed by Agent B = provider)
    // This proves Agent B fulfilled the A→B order.
    const resultHash = keccak256(toUtf8Bytes(`fulfill:${aToBOrderId}:${task}`));
    const aToBFulfillment = await recordFulfillment({
      orderId: aToBOrderId,
      resultHash,
      serviceId: bToCServiceId,
      transactionRef: keccak256(toUtf8Bytes(`${aToBOrderId}`)),
    }, AGENT_B_PRIVATE_KEY);

    return {
      ok: true,
      orderId: outcome.orderId,
      provider: bToCProvider,
      serviceId: bToCServiceId,
      bToCPaymentTx: bToCPayment.txHash,
      aToBFulfillmentTx: aToBFulfillment.txHash,
      /** Honest flags: did the Sepolia recordings actually broadcast? */
      bToCPaymentRecorded: bToCPayment.ok,
      aToBFulfillmentRecorded: aToBFulfillment.ok,
    };
  } finally {
    await close();
  }
}

/**
 * A2A AgentExecutor implementation for Agent B.
 * Receives tasks via the A2A protocol and executes them.
 */
export class AgentBExecutor implements AgentExecutor {
  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const task = extractText(requestContext.userMessage.parts);

    if (!task) {
      eventBus.publish(AgentEvent.message(agentMessage('No task provided', {
        taskId: requestContext.taskId,
        contextId: requestContext.contextId,
      })));
      eventBus.finished();
      return;
    }

    // Extract metadata
    const metadata = (requestContext.userMessage.metadata ?? {}) as Record<string, unknown>;
    const metaOrderId = metadata.aToBOrderId as string | undefined;
    const aToBOrderId = BigInt(metaOrderId ?? '800000');

    // CRITICAL: Verify Agent A's delegation signature before executing.
    // A delegation WITHOUT a valid signature is REJECTED, not executed —
    // an unverified caller must never be able to spend Agent B's wallet.
    const delegationPayload = metadata.delegationPayload as string | undefined;
    const delegationSignature = metadata.delegationSignature as string | undefined;
    const claimedAgent = metadata.agent as string | undefined;

    const reject = (reason: string): void => {
      console.warn(`[agent-b] Delegation rejected: ${reason}`);
      eventBus.publish(AgentEvent.task(taskEvent(
        requestContext.taskId,
        requestContext.contextId,
        TaskState.TASK_STATE_FAILED,
        agentMessage(`Delegation rejected: ${reason}`, { taskId: requestContext.taskId, contextId: requestContext.contextId }),
      )));
      eventBus.finished();
    };

    let verifiedAgent: string | null;
    if (!delegationPayload || !delegationSignature) {
      return reject('missing signed delegation payload/signature');
    }
    verifiedAgent = verifyDelegationSignature(delegationPayload, delegationSignature, {
      orderId: metaOrderId,
      task,
    });
    if (!verifiedAgent) {
      return reject('invalid or stale delegation signature');
    }
    if (claimedAgent && claimedAgent.toLowerCase() !== verifiedAgent.toLowerCase()) {
      return reject('metadata agent does not match signature');
    }
    console.log(`[agent-b] Verified delegation from agent: ${verifiedAgent}`);

    // Publish a task event to acknowledge receipt
    eventBus.publish(AgentEvent.task(taskEvent(
      requestContext.taskId,
      requestContext.contextId,
      TaskState.TASK_STATE_WORKING,
      agentMessage(`Processing: ${task}`, { taskId: requestContext.taskId, contextId: requestContext.contextId }),
    )));

    try {
      const result = await executeDelegatedTask(task, aToBOrderId, verifiedAgent);

      // Publish the final result
      eventBus.publish(AgentEvent.task(taskEvent(
        requestContext.taskId,
        requestContext.contextId,
        result.ok ? TaskState.TASK_STATE_COMPLETED : TaskState.TASK_STATE_FAILED,
        agentMessage(JSON.stringify({
          ok: result.ok,
          orderId: result.orderId,
          provider: result.provider,
          bToCPaymentTx: result.bToCPaymentTx,
          bToCPaymentRecorded: result.bToCPaymentRecorded,
          aToBFulfillmentTx: result.aToBFulfillmentTx,
          aToBFulfillmentRecorded: result.aToBFulfillmentRecorded,
          verifiedAgent,
          error: result.error,
        }), { taskId: requestContext.taskId, contextId: requestContext.contextId }),
      )));
    } catch (err) {
      eventBus.publish(AgentEvent.task(taskEvent(
        requestContext.taskId,
        requestContext.contextId,
        TaskState.TASK_STATE_FAILED,
        agentMessage(`Error: ${err instanceof Error ? err.message : String(err)}`, {
          taskId: requestContext.taskId,
          contextId: requestContext.contextId,
        }),
      )));
    }

    eventBus.finished();
  }

  async cancelTask(_taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    // Terminal acknowledgment; the in-flight purchase cannot be rolled back
    // mid-broadcast, so cancellation takes effect for future cycles.
    eventBus.finished();
  }
}
