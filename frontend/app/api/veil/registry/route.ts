import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { Contract, JsonRpcProvider, Wallet } from 'ethers';

const VEIL_REGISTRY_ADDRESS = process.env.VEIL_REGISTRY_ADDRESS ?? '';
const CC3_RPC_URL = process.env.CREDITCOIN_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network';
const AGENT_WALLET_PRIVATE_KEY = process.env.SOURCE_CHAIN_WALLET_PRIVATE_KEY ?? '';

const REGISTRY_READ_ABI = [
  'function listActiveAgents() view returns (uint256[])',
  'function getAgent(uint256 agentId) view returns (address, uint8, bytes32, string, string, uint256, uint256)',
  'function activeAgentCount() view returns (uint256)',
  'function isAgentActive(uint256 agentId) view returns (bool)',
];

const REGISTRY_WRITE_ABI = [
  'function registerAgent(string endpoint, string agentCardHash, bytes32 reputationRef) returns (uint256)',
];

async function getRegistryRead() {
  const provider = new JsonRpcProvider(CC3_RPC_URL);
  return new Contract(VEIL_REGISTRY_ADDRESS, REGISTRY_READ_ABI, provider);
}

async function getRegistryWrite() {
  const provider = new JsonRpcProvider(CC3_RPC_URL);
  const wallet = new Wallet(AGENT_WALLET_PRIVATE_KEY, provider);
  return new Contract(VEIL_REGISTRY_ADDRESS, REGISTRY_WRITE_ABI, wallet);
}

/** GET /api/veil/registry — list all active agents from on-chain registry */
export async function GET(): Promise<NextResponse> {
  try {
    if (!VEIL_REGISTRY_ADDRESS) {
      return NextResponse.json({ ok: false, error: 'VEIL_REGISTRY_ADDRESS not configured' }, { status: 500 });
    }
    const registry = await getRegistryRead();
    const activeIds: bigint[] = await registry.listActiveAgents();
    const agents = await Promise.all(
      activeIds.map(async (id) => {
        const [owner, status, repRef, endpoint, cardHash, registeredAt, lastHealthCheck] = await registry.getAgent(id);
        return {
          agentId: Number(id),
          owner,
          status: Number(status),
          reputationRef: repRef,
          endpoint,
          cardHash,
          registeredAt: Number(registeredAt),
          lastHealthCheck: Number(lastHealthCheck),
        };
      }),
    );
    // Deduplicate by owner address — keep only the most recent registration per wallet.
    // This handles the case where the same agent restarted and re-registered multiple times.
    const seen = new Map<string, typeof agents[0]>();
    for (const a of agents) {
      const key = a.owner.toLowerCase();
      const existing = seen.get(key);
      if (!existing || a.registeredAt > existing.registeredAt) {
        seen.set(key, a);
      }
    }
    const uniqueAgents = Array.from(seen.values());
    return NextResponse.json({ ok: true, agents: uniqueAgents, registryAddress: VEIL_REGISTRY_ADDRESS });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** POST /api/veil/registry — register a new agent on-chain */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    if (!VEIL_REGISTRY_ADDRESS) {
      return NextResponse.json({ ok: false, error: 'VEIL_REGISTRY_ADDRESS not configured' }, { status: 500 });
    }
    if (!AGENT_WALLET_PRIVATE_KEY) {
      return NextResponse.json({ ok: false, error: 'SOURCE_CHAIN_WALLET_PRIVATE_KEY not configured' }, { status: 500 });
    }
    const body = await req.json();
    const { endpoint, agentCardHash, reputationRef } = body;
    if (!endpoint || typeof endpoint !== 'string') {
      return NextResponse.json({ ok: false, error: 'endpoint (string) is required' }, { status: 400 });
    }
    const registry = await getRegistryWrite();
    const tx = await registry.registerAgent(
      endpoint,
      agentCardHash ?? '',
      reputationRef ?? '0x' + '00'.repeat(32),
    );
    const receipt = await tx.wait();
    const agentId = receipt.logs?.[0]?.topics?.[1]
      ? BigInt(receipt.logs[0].topics[1]).toString()
      : 'unknown';
    return NextResponse.json({ ok: true, agentId, txHash: receipt.hash });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
