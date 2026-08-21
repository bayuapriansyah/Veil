/**
 * Agent B — A2A server.
 *
 * Express server that exposes the A2A JSON-RPC endpoint and the Agent Card.
 * Agent B is a separate identity with its own wallet, shop, and on-chain
 * settlement flow.
 *
 * Endpoints:
 *   GET  /.well-known/agent-card.json  — Agent Card (A2A discovery)
 *   POST /a2a                           — A2A JSON-RPC (sendMessage, getTask, etc.)
 *   GET  /health                        — Health check
 */
import express from 'express';
import { DefaultRequestHandler, InMemoryTaskStore } from '@a2a-js/sdk/server';
import { AgentCard } from '@a2a-js/sdk';
import { Wallet } from 'ethers';
import { AgentBExecutor } from './executor';

const AGENT_B_PORT = Number(process.env.AGENT_B_PORT ?? 8081);
const AGENT_B_PRIVATE_KEY = process.env.AGENT_B_WALLET_PRIVATE_KEY ?? '';
const AGENT_B_ADDRESS = AGENT_B_PRIVATE_KEY ? new Wallet(AGENT_B_PRIVATE_KEY).address : '0x' + '00'.repeat(20);

/** Agent B's A2A Agent Card — describes capabilities for discovery. */
const AGENT_B_CARD: AgentCard = {
  name: 'VEIL Agent B',
  description: 'A procurement agent that buys verified market-data services from Shop C on behalf of delegating agents. Accepts delegated tasks via A2A protocol, executes purchases on-chain, and returns verified results.',
  url: `http://127.0.0.1:${AGENT_B_PORT}`,
  version: '1.0.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  authentication: { schemes: [] },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  skills: [
    {
      id: 'veil-procurement',
      name: 'VEIL Procurement',
      description: 'Buys market-data services from Shop C using the VEIL settlement rail (x402 + Attestcoin). Returns verified fulfillment.',
      tags: ['procurement', 'market-data', 'settlement', 'veil'],
      examples: ['buy market data from the eligible provider'],
    },
  ],
  supportsAuthenticatedExtendedCard: false,
};

export async function startAgentB(): Promise<{ port: number; close: () => Promise<void> }> {
  if (!AGENT_B_PRIVATE_KEY) {
    console.warn('[agent-b] AGENT_B_WALLET_PRIVATE_KEY not set — Agent B will not start');
    return { port: 0, close: async () => {} };
  }

  const app = express();
  app.use(express.json());

  // A2A setup: request handler + task store + executor
  const taskStore = new InMemoryTaskStore();
  const executor = new AgentBExecutor();
  const requestHandler = new DefaultRequestHandler(
    AGENT_B_CARD,
    taskStore,
    executor,
  );

  // Agent Card endpoint (A2A discovery)
  app.get('/.well-known/agent-card.json', (_req, res) => {
    res.json(AGENT_B_CARD);
  });

  // A2A JSON-RPC endpoint
  app.post('/a2a', async (req, res) => {
    try {
      const { method, params, id } = req.body;
      const context = { user: { id: 'agent-a' } };

      let result: unknown;
      switch (method) {
        case 'message/send':
          result = await requestHandler.sendMessage(params, context);
          break;
        case 'tasks/get':
          result = await requestHandler.getTask(params, context);
          break;
        case 'tasks/cancel':
          result = await requestHandler.cancelTask(params, context);
          break;
        case 'tasks/list':
          result = await requestHandler.listTasks(params, context);
          break;
        default:
          res.json({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          });
          return;
      }

      res.json({ jsonrpc: '2.0', id, result });
    } catch (err) {
      res.json({
        jsonrpc: '2.0',
        id: req.body?.id ?? null,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      agent: 'B',
      address: AGENT_B_ADDRESS,
      port: AGENT_B_PORT,
    });
  });

  return new Promise((resolve) => {
    const server = app.listen(AGENT_B_PORT, () => {
      console.log(`[agent-b] A2A server listening on http://127.0.0.1:${AGENT_B_PORT}`);
      console.log(`[agent-b] Agent Card: http://127.0.0.1:${AGENT_B_PORT}/.well-known/agent-card.json`);
      console.log(`[agent-b] A2A endpoint: http://127.0.0.1:${AGENT_B_PORT}/a2a`);
      console.log(`[agent-b] Address: ${AGENT_B_ADDRESS}`);
      resolve({
        port: AGENT_B_PORT,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

// Start when run directly: npx tsx services/agent-b/server.ts
void startAgentB();
