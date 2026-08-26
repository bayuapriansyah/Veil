/**
 * Agent A — A2A client.
 *
 * Sends delegated tasks to Agent B via the A2A JSON-RPC protocol.
 * Used by the frontend runtime (veil-runtime.ts) to delegate procurement
 * tasks to Agent B.
 *
 * Supports on-chain discovery via VeilRegistry (CC3) — if AGENT_B_URL is not
 * set, the client queries the registry for active agents and uses the first one.
 *
 * CRITICAL: Agent B's wallet address is resolved from the registry, NOT hardcoded.
 * This ensures Agent A always pays the correct agent.
 */
import { Wallet, Contract, JsonRpcProvider, keccak256, toUtf8Bytes } from 'ethers';

const AGENT_B_URL_FALLBACK = process.env.AGENT_B_URL ?? 'http://127.0.0.1:8081';
const CC3_RPC_URL = process.env.CREDITCOIN_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network';

function getRegistryAddress(): string {
  return process.env.VEIL_REGISTRY_ADDRESS
    ?? process.env.NEXT_PUBLIC_VEIL_REGISTRY_ADDRESS
    ?? '';
}

const REGISTRY_ABI = [
  'function listActiveAgents() view returns (uint256[])',
  'function getAgentEndpoint(uint256 agentId) view returns (string)',
  'function agentOwner(uint256 agentId) view returns (address)',
  'function getAgent(uint256 agentId) view returns (address, uint8, bytes32, string, string, uint256, uint256)',
];

export interface DiscoveredAgent {
  agentId: number;
  endpoint: string;
  walletAddress: string; // Agent B's on-chain wallet address (owner in registry)
}

/**
 * Discover Agent B from the on-chain VeilRegistry (CC3).
 * Returns endpoint + wallet address, or null if none found.
 */
export async function discoverAgentFromRegistry(): Promise<DiscoveredAgent | null> {
  const addr = getRegistryAddress();
  if (!addr) return null;
  try {
    const provider = new JsonRpcProvider(CC3_RPC_URL);
    const registry = new Contract(addr, REGISTRY_ABI, provider);
    const activeIds: bigint[] = await registry.listActiveAgents();
    if (activeIds.length === 0) return null;
    const agentId = Number(activeIds[0]);
    const [endpoint, walletAddress] = await Promise.all([
      registry.getAgentEndpoint(activeIds[0]),
      registry.agentOwner(activeIds[0]),
    ]);
    return { agentId, endpoint, walletAddress };
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
  return discovered?.endpoint ?? AGENT_B_URL_FALLBACK;
}

/**
 * Resolve Agent B wallet address from on-chain registry.
 * Falls back to env var AGENT_B_WALLET_ADDRESS or null.
 */
export async function resolveAgentBAddress(): Promise<string | null> {
  const discovered = await discoverAgentFromRegistry();
  if (discovered) return discovered.walletAddress;
  return process.env.AGENT_B_WALLET_ADDRESS ?? null;
}

export interface AgentBDelegationResult {
  ok: boolean;
  taskId?: string;
  orderId?: string;
  provider?: string;
  bToCPaymentTx?: string;
  bToCPaymentRecorded?: boolean;
  aToBFulfillmentTx?: string;
  aToBFulfillmentRecorded?: boolean;
  error?: string;
}

/** JSON-RPC response envelope. */
interface JsonRpcResponse {
  jsonrpc?: string;
  id?: string | number | null;
  error?: { code?: number; message?: string } | null;
  result?: A2aTaskResult | A2aMessageResult | null;
}

/** Terminal task shape (subset used by the client). */
interface A2aTaskResult {
  id?: string;
  contextId?: string;
  status?: {
    state?: string | number;
    message?: A2aMessageResult;
  };
}

/** Message shape (subset used by the client). */
interface A2aMessageResult {
  role?: string | number;
  parts?: Array<{ content?: { $case?: string; value?: unknown }; text?: string }>;
  metadata?: Record<string, unknown>;
}

/** Extract concatenated text from v1 (or legacy) part arrays. */
function extractPartsText(parts: A2aMessageResult['parts']): string {
  return (parts ?? [])
    .map((p) => {
      if (p?.content && p.content.$case === 'text' && typeof p.content.value === 'string') return p.content.value;
      // Legacy flat shape fallback
      const legacy = (p as { text?: unknown })?.text;
      return typeof legacy === 'string' ? legacy : '';
    })
    .filter(Boolean)
    .join(' ')
    .trim();
}

const TASK_COMPLETED_STATES = new Set(['TASK_STATE_COMPLETED', 'COMPLETED', 3]);

/**
 * Send a delegated task to Agent B via A2A JSON-RPC.
 *
 * CRITICAL: The message is signed by Agent A's wallet. Agent B MUST verify
 * this signature before executing — this proves the delegation came from
 * a specific on-chain agent, not an impersonator.
 *
 * @param task - The procurement task description
 * @param agentPrivateKey - Agent A's private key (for signing + metadata)
 * @param aToBOrderId - The A→B order ID (from Agent A's shop)
 */
export async function delegateToAgentB(
  task: string,
  agentPrivateKey: string,
  aToBOrderId: bigint,
): Promise<AgentBDelegationResult> {
  const wallet = new Wallet(agentPrivateKey);
  const agentAddress = wallet.address;
  const agentBUrl = await resolveAgentBUrl();

  // Sign the delegation message for Agent B to verify.
  // The signed payload includes orderId + agent address + timestamp.
  // Agent B will verify: signer == agentAddress before executing.
  const timestamp = Date.now();
  const payload = JSON.stringify({
    type: 'a2a-delegation',
    orderId: aToBOrderId.toString(),
    agent: agentAddress,
    task,
    timestamp,
  });
  const payloadHash = keccak256(toUtf8Bytes(payload));
  const signature = await wallet.signMessage(payloadHash);

  try {
    // A2A JSON-RPC: message/send with signed delegation
    const response = await fetch(`${agentBUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `delegation-${aToBOrderId}`,
        method: 'SendMessage',
        params: {
          tenant: '',
          message: {
            messageId: `msg-${aToBOrderId}-${timestamp}`,
            role: 'ROLE_USER',
            parts: [{ text: task }],
            metadata: {
              aToBOrderId: aToBOrderId.toString(),
              agent: agentAddress,
              timestamp,
              // CRITICAL: Signed delegation payload for verification
              delegationPayload: payload,
              delegationSignature: signature,
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

    const rpc = (await response.json()) as JsonRpcResponse;
    if (rpc.error) {
      return { ok: false, error: rpc.error.message ?? JSON.stringify(rpc.error) };
    }

    // Parse the result — SDK wraps in { task: ... } or { message: ... }
    const raw = rpc.result as Record<string, unknown> | undefined;
    if (!raw) {
      return { ok: false, error: 'Empty A2A response' };
    }

    // Unwrap: SDK returns { task: Task } or { message: Message }
    const taskResult = (raw as { task?: A2aTaskResult }).task;
    const msgResult = (raw as { message?: A2aMessageResult }).message;
    const unwrapped = taskResult ?? msgResult ?? raw;

    // If it's a Task, extract status
    if ('status' in unwrapped && unwrapped.status) {
      const st = unwrapped.status as A2aTaskResult['status'];
      const statusMsg = extractPartsText(st?.message?.parts);
      try {
        const parsed = JSON.parse(statusMsg) as Partial<AgentBDelegationResult>;
        return {
          ok: parsed.ok ?? TASK_COMPLETED_STATES.has(st?.state as never),
          taskId: String(unwrapped.id ?? taskResult?.id ?? ''),
          orderId: parsed.orderId,
          provider: parsed.provider,
          bToCPaymentTx: parsed.bToCPaymentTx,
          bToCPaymentRecorded: parsed.bToCPaymentRecorded,
          aToBFulfillmentTx: parsed.aToBFulfillmentTx,
          aToBFulfillmentRecorded: parsed.aToBFulfillmentRecorded,
          error: parsed.error,
        };
      } catch {
        return {
          ok: TASK_COMPLETED_STATES.has(st?.state as never),
          taskId: String(unwrapped.id ?? taskResult?.id ?? ''),
          orderId: undefined,
          error: statusMsg || `Task state: ${st?.state}`,
        };
      }
    }

    // If it's a Message
    if ('parts' in unwrapped) {
      const text = extractPartsText((unwrapped as A2aMessageResult).parts);
      try {
        const parsed = JSON.parse(text) as Partial<AgentBDelegationResult>;
        return {
          ok: parsed.ok ?? false,
          orderId: parsed.orderId,
          provider: parsed.provider,
          bToCPaymentTx: parsed.bToCPaymentTx,
          bToCPaymentRecorded: parsed.bToCPaymentRecorded,
          aToBFulfillmentTx: parsed.aToBFulfillmentTx,
          aToBFulfillmentRecorded: parsed.aToBFulfillmentRecorded,
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
    const data = (await res.json()) as { ok?: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}
