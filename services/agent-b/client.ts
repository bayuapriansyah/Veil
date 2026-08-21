/**
 * Agent A — A2A client.
 *
 * Sends delegated tasks to Agent B via the A2A JSON-RPC protocol.
 * Used by the frontend runtime (veil-runtime.ts) to delegate procurement
 * tasks to Agent B.
 *
 * Supports on-chain discovery via VeilRegistry (CC3) — if AGENT_B_URL is not
 * set, the client queries the registry for active agents and uses the first one.
 */
import { Wallet, Contract, JsonRpcProvider, keccak256, toUtf8Bytes } from 'ethers';

const AGENT_B_URL_FALLBACK = process.env.AGENT_B_URL ?? 'http://127.0.0.1:8081';
const VEIL_REGISTRY_ADDRESS = process.env.VEIL_REGISTRY_ADDRESS ?? '';
const CC3_RPC_URL = process.env.CREDITCOIN_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network';

const REGISTRY_ABI = [
  'function listActiveAgents() view returns (uint256[])',
  'function getAgentEndpoint(uint256 agentId) view returns (string)',
  'function getAgent(uint256 agentId) view returns (address, uint8, bytes32, string, string, uint256, uint256)',
];

/**
 * Discover Agent B's endpoint from the on-chain VeilRegistry (CC3).
 * Returns the endpoint URL of the first active agent, or null if none found.
 */
export async function discoverAgentFromRegistry(): Promise<string | null> {
  if (!VEIL_REGISTRY_ADDRESS) return null;
  try {
    const provider = new JsonRpcProvider(CC3_RPC_URL);
    const registry = new Contract(VEIL_REGISTRY_ADDRESS, REGISTRY_ABI, provider);
    const activeIds: bigint[] = await registry.listActiveAgents();
    if (activeIds.length === 0) return null;
    const endpoint: string = await registry.getAgentEndpoint(activeIds[0]);
    return endpoint || null;
  } catch {
    return null;
  }
}

/**
 * Resolve Agent B URL: use env var if set, otherwise discover from on-chain registry.
 */
export async function resolveAgentBUrl(): Promise<string> {
  if (process.env.AGENT_B_URL) return process.env.AGENT_B_URL;
  const discovered = await discoverAgentFromRegistry();
  return discovered ?? AGENT_B_URL_FALLBACK;
}

export interface AgentBDelegationResult {
  ok: boolean;
  taskId?: string;
  orderId?: string;
  provider?: string;
  bToCPaymentTx?: string;
  aToBFulfillmentTx?: string;
  error?: string;
}

/**
 * Send a delegated task to Agent B via A2A JSON-RPC.
 *
 * @param task - The procurement task description
 * @param agentPrivateKey - Agent A's private key (for metadata)
 * @param aToBOrderId - The A→B order ID (from Agent A's shop)
 */
export async function delegateToAgentB(
  task: string,
  agentPrivateKey: string,
  aToBOrderId: bigint,
): Promise<AgentBDelegationResult> {
  const agentAddress = new Wallet(agentPrivateKey).address;
  const agentBUrl = await resolveAgentBUrl();

  try {
    // A2A JSON-RPC: message/send
    const response = await fetch(`${agentBUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `delegation-${aToBOrderId}`,
        method: 'message/send',
        params: {
          tenant: '',
          message: {
            messageId: `msg-${aToBOrderId}-${Date.now()}`,
            role: 'user',
            parts: [{ text: task }],
            metadata: {
              aToBOrderId: aToBOrderId.toString(),
              agent: agentAddress,
              timestamp: Date.now(),
            },
          },
          configuration: {},
          metadata: {},
        },
      }),
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${await response.text()}` };
    }

    const rpc = await response.json();
    if (rpc.error) {
      return { ok: false, error: rpc.error.message ?? JSON.stringify(rpc.error) };
    }

    // Parse the result (Message or Task)
    const result = rpc.result;
    if (!result) {
      return { ok: false, error: 'Empty A2A response' };
    }

    // If it's a Task, extract status
    if (result.status) {
      const statusMsg = result.status.message?.parts?.[0]?.text ?? '';
      try {
        const parsed = JSON.parse(statusMsg);
        return {
          ok: parsed.ok ?? false,
          taskId: result.id,
          orderId: parsed.orderId,
          provider: parsed.provider,
          bToCPaymentTx: parsed.bToCPaymentTx,
          aToBFulfillmentTx: parsed.aToBFulfillmentTx,
          error: parsed.error,
        };
      } catch {
        return {
          ok: result.status.state === 'completed',
          taskId: result.id,
          orderId: undefined,
          error: statusMsg || `Task state: ${result.status.state}`,
        };
      }
    }

    // If it's a Message
    if (result.parts) {
      const text = result.parts.map((p: { text?: string }) => p.text).filter(Boolean).join('');
      try {
        const parsed = JSON.parse(text);
        return {
          ok: parsed.ok ?? false,
          taskId: undefined,
          orderId: parsed.orderId,
          provider: parsed.provider,
          bToCPaymentTx: parsed.bToCPaymentTx,
          aToBFulfillmentTx: parsed.aToBFulfillmentTx,
          error: parsed.error,
        };
      } catch {
        return { ok: true, orderId: undefined, error: text };
      }
    }

    return { ok: false, error: 'Unknown A2A response format' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Check if Agent B is reachable.
 */
export async function checkAgentBHealth(): Promise<boolean> {
  try {
    const url = await resolveAgentBUrl();
    const res = await fetch(`${url}/health`);
    if (!res.ok) return false;
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}
