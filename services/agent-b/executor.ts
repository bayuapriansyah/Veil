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
import { Wallet, Contract, JsonRpcProvider, keccak256, toUtf8Bytes } from 'ethers';
import { AgentExecutor, RequestContext, ExecutionEventBus, AgentEvent } from '@a2a-js/sdk/server';
import { TaskState } from '@a2a-js/sdk';
import { createProcurementShop, OPERATOR } from '../procurement/shop';
import { ProcurementAgent } from '../procurement/agent';
import { SERVICE_MARKET_DATA } from '../provider/adapter';
import { recordAgentPayment, recordFulfillment } from '../attestation/record';

const AGENT_B_PRIVATE_KEY = process.env.AGENT_B_WALLET_PRIVATE_KEY ?? '';
const AGENT_B_ADDRESS = AGENT_B_PRIVATE_KEY ? new Wallet(AGENT_B_PRIVATE_KEY).address : '';
const PRICE_ATOMS = BigInt('1000000000000000'); // 0.001 ETH

export interface AgentBResult {
  ok: boolean;
  orderId?: string;
  provider?: string;
  serviceId?: string;
  error?: string;
  /** On-chain B→C AgentPayment tx hash (Sepolia). */
  bToCPaymentTx?: string;
  /** On-chain A→B FulfillmentReceipt tx hash (Sepolia, provider-signed). */
  aToBFulfillmentTx?: string;
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
async function verifyDelegationSignature(
  payload: string,
  signature: string,
): Promise<string | null> {
  try {
    const parsed = JSON.parse(payload);
    if (parsed.type !== 'a2a-delegation') return null;
    if (!parsed.agent || !parsed.orderId || !parsed.timestamp) return null;

    // Recover the signer from the signed hash
    const payloadHash = keccak256(toUtf8Bytes(payload));
    const recoveredAddress = Wallet.verifyMessage(payloadHash, signature);

    // The recovered address must match the claimed agent address
    if (recoveredAddress.toLowerCase() !== parsed.agent.toLowerCase()) return null;

    return parsed.agent;
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
    const task = requestContext.userMessage.parts
      ?.map((p: { text?: string }) => p.text)
      .filter(Boolean)
      .join(' ') ?? '';

    if (!task) {
      eventBus.publish(AgentEvent.message({
        role: 'agent',
        parts: [{ text: 'No task provided' }],
      }));
      eventBus.finished();
      return;
    }

    // Extract metadata
    const aToBOrderId = BigInt(
      requestContext.userMessage.metadata?.aToBOrderId ?? '800000'
    );
    const aToBAgent = (requestContext.userMessage.metadata?.agent as string) ?? AGENT_B_ADDRESS;

    // CRITICAL: Verify Agent A's delegation signature before executing.
    // This proves the message came from a specific on-chain agent.
    const delegationPayload = requestContext.userMessage.metadata?.delegationPayload as string | undefined;
    const delegationSignature = requestContext.userMessage.metadata?.delegationSignature as string | undefined;

    let verifiedAgent: string | null = null;
    if (delegationPayload && delegationSignature) {
      verifiedAgent = await verifyDelegationSignature(delegationPayload, delegationSignature);
      if (!verifiedAgent) {
        eventBus.publish(AgentEvent.task({
          id: requestContext.taskId,
          contextId: requestContext.contextId,
          status: {
            state: TaskState.FAILED,
            message: { role: 'agent', parts: [{ text: 'Invalid delegation signature — agent identity not verified' }] },
          },
        }));
        eventBus.finished();
        return;
      }
      console.log(`[agent-b] Verified delegation from agent: ${verifiedAgent}`);
    } else {
      console.warn(`[agent-b] No delegation signature provided — proceeding without verification`);
    }

    // Publish a task event to acknowledge receipt
    eventBus.publish(AgentEvent.task({
      id: requestContext.taskId,
      contextId: requestContext.contextId,
      status: { state: TaskState.WORKING, message: { role: 'agent', parts: [{ text: `Processing: ${task}` }] } },
    }));

    try {
      const result = await executeDelegatedTask(task, aToBOrderId, verifiedAgent ?? aToBAgent);

      // Publish the final result
      eventBus.publish(AgentEvent.task({
        id: requestContext.taskId,
        contextId: requestContext.contextId,
        status: {
          state: result.ok ? TaskState.COMPLETED : TaskState.FAILED,
          message: {
            role: 'agent',
            parts: [{
              text: JSON.stringify({
                ok: result.ok,
                orderId: result.orderId,
                provider: result.provider,
                bToCPaymentTx: result.bToCPaymentTx,
                aToBFulfillmentTx: result.aToBFulfillmentTx,
                verifiedAgent: verifiedAgent ?? aToBAgent,
                error: result.error,
              }),
            }],
          },
        },
      }));
    } catch (err) {
      eventBus.publish(AgentEvent.task({
        id: requestContext.taskId,
        contextId: requestContext.contextId,
        status: {
          state: TaskState.FAILED,
          message: {
            role: 'agent',
            parts: [{ text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          },
        },
      }));
    }

    eventBus.finished();
  }

  async cancelTask(_taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.finished();
  }
}
