/**
 * Agent A — A2A client.
 *
 * Sends delegated tasks to Agent B via the A2A JSON-RPC protocol.
 * Used by the frontend runtime (veil-runtime.ts) to delegate procurement
 * tasks to Agent B.
 */
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';

const AGENT_B_URL = process.env.AGENT_B_URL ?? 'http://127.0.0.1:8081';

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

  try {
    // A2A JSON-RPC: message/send
    const response = await fetch(`${AGENT_B_URL}/a2a`, {
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
    const res = await fetch(`${AGENT_B_URL}/health`);
    if (!res.ok) return false;
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}
