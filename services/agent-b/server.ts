/**
 * Agent B — A2A server.
 *
 * Express server that exposes the A2A JSON-RPC endpoint and the Agent Card.
 * Agent B is a separate identity with its own wallet, shop, and on-chain
 * settlement flow.
 *
 * On startup, Agent B self-registers on the VeilRegistry contract on CC3,
 * making its endpoint discoverable by Agent A on-chain.
 *
 * Endpoints:
 *   GET  /.well-known/agent-card.json  — Agent Card (A2A discovery)
 *   POST /a2a                           — A2A JSON-RPC (sendMessage, getTask, etc.)
 *   GET  /health                        — Health check
 */
import express from 'express';
import { DefaultRequestHandler, InMemoryTaskStore, JsonRpcTransportHandler, ServerCallContext } from '@a2a-js/sdk/server';
import { AgentCard } from '@a2a-js/sdk';
import { Wallet, Contract, JsonRpcProvider } from 'ethers';
import { AgentBExecutor } from './executor';

const AGENT_B_PORT = Number(process.env.AGENT_B_PORT ?? 8081);
const AGENT_B_PRIVATE_KEY = process.env.AGENT_B_WALLET_PRIVATE_KEY ?? '';
const AGENT_B_ADDRESS = AGENT_B_PRIVATE_KEY ? new Wallet(AGENT_B_PRIVATE_KEY).address : '0x' + '00'.repeat(20);

const VEIL_REGISTRY_ADDRESS = process.env.VEIL_REGISTRY_ADDRESS ?? '';
const CC3_RPC_URL = process.env.CREDITCOIN_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network';

// Agent B's on-chain identity (populated at registration)
let agentBRegistryId: number | null = null;

/** Agent B's A2A Agent Card (v1 schema) — describes capabilities for discovery. */
const AGENT_B_CARD: AgentCard = {
  name: 'VEIL Agent B',
  description: `Procurement agent (wallet: ${AGENT_B_ADDRESS}). Buys verified market-data services from Shop C on behalf of delegating agents. Accepts delegated tasks via A2A protocol, executes purchases on-chain, and returns verified results.`,
  supportedInterfaces: [{
    url: `http://127.0.0.1:${AGENT_B_PORT}/a2a`,
    protocolBinding: 'JSONRPC',
    tenant: '',
    protocolVersion: '1.0',
  }],
  provider: { organization: 'VEIL', url: 'https://github.com/bayuapriansyah/Veil' },
  version: '1.0.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    extensions: [],
  },
  securitySchemes: {},
  securityRequirements: [],
  signatures: [],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [
    {
      id: 'veil-procurement',
      name: 'VEIL Procurement',
      description: 'Buys market-data services from Shop C using the VEIL settlement rail (x402 + Attestcoin). Returns verified fulfillment.',
      tags: ['procurement', 'market-data', 'settlement', 'veil'],
      examples: ['buy market data from the eligible provider'],
      inputModes: ['text/plain'],
      outputModes: ['text/plain'],
      securityRequirements: [],
    },
  ],
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

  // A2A JSON-RPC endpoint (SDK transport handles method routing + validation)
  const transportHandler = new JsonRpcTransportHandler(requestHandler);
  app.post('/a2a', async (req, res) => {
    try {
      const response = await transportHandler.handle(req.body, new ServerCallContext());
      res.json(response);
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
      registryId: agentBRegistryId,
      registryAddress: VEIL_REGISTRY_ADDRESS || undefined,
    });
  });

  return new Promise((resolve) => {
    const server = app.listen(AGENT_B_PORT, async () => {
      console.log(`[agent-b] A2A server listening on http://127.0.0.1:${AGENT_B_PORT}`);
      console.log(`[agent-b] Agent Card: http://127.0.0.1:${AGENT_B_PORT}/.well-known/agent-card.json`);
      console.log(`[agent-b] A2A endpoint: http://127.0.0.1:${AGENT_B_PORT}/a2a`);
      console.log(`[agent-b] Address: ${AGENT_B_ADDRESS}`);

      // Self-register on VeilRegistry (CC3) if configured
      // Check if already registered to avoid duplicate entries on restart.
      if (VEIL_REGISTRY_ADDRESS && AGENT_B_PRIVATE_KEY) {
        try {
          const provider = new JsonRpcProvider(CC3_RPC_URL);
          const wallet = new Wallet(AGENT_B_PRIVATE_KEY, provider);
          const registry = new Contract(
            VEIL_REGISTRY_ADDRESS,
            [
              'function registerAgent(string endpoint, string agentCardHash, bytes32 reputationRef) returns (uint256)',
              'function isAgentActive(uint256 agentId) view returns (bool)',
              'function listActiveAgents() view returns (uint256[])',
              'function agentOwner(uint256 agentId) view returns (address)',
            ],
            wallet,
          );

          // Check if this wallet is already registered (avoid duplicate entries on restart)
          const existingIds: bigint[] = await registry.listActiveAgents();
          for (const id of existingIds) {
            const owner = await registry.agentOwner(id);
            if (owner.toLowerCase() === AGENT_B_ADDRESS.toLowerCase()) {
              agentBRegistryId = Number(id);
              console.log(`[agent-b] Already registered: agentId=${agentBRegistryId}, wallet=${AGENT_B_ADDRESS}`);
              resolve({ port: AGENT_B_PORT, close: () => new Promise<void>((res) => server.close(() => res())) });
              return;
            }
          }

          // Not registered — proceed with registration
          const endpoint = `http://127.0.0.1:${AGENT_B_PORT}`;
          const cardHash = 'QmAgentB'; // placeholder — could be IPFS hash
          const reputationRef = '0x' + '00'.repeat(32);
          const tx = await registry.registerAgent(endpoint, cardHash, reputationRef);
          const receipt = await tx.wait();
          const rawId = receipt.logs?.[0]?.topics?.[1];
          agentBRegistryId = rawId ? Number(BigInt(rawId)) : null;
          console.log(`[agent-b] Registered on VeilRegistry: agentId=${agentBRegistryId}, wallet=${AGENT_B_ADDRESS}, tx=${receipt.hash}`);
        } catch (err) {
          console.warn(`[agent-b] VeilRegistry registration failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      resolve({
        port: AGENT_B_PORT,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

// Start when run directly: npx tsx services/agent-b/server.ts
void startAgentB();
