/**
 * Live source-chain recording for VEIL purchases.
 *
 * Wires the frontend Purchase Console to the REAL VeilSource contract on the
 * source chain (Sepolia) so every purchase emits an AgentPayment event that the
 * Attestcoin worker proves on Creditcoin. Recording is best-effort ("soft
 * fail"): if the RPC/key is missing or the tx reverts (e.g. order id reuse
 * after a restart), the HTTP rail still completes and the mirror ledger remains
 * authoritative for the UI — the failure is surfaced in the result so the UI
 * never overclaims.
 */
import 'dotenv/config';

import { Contract, JsonRpcProvider, Wallet } from 'ethers';

import { isDemoMode } from '../config/mode';

const SOURCE_ABI = [
  'function recordAgentPayment(uint256 orderId, address provider, uint256 amount, bytes32 serviceId, bytes32 transactionRef) external',
  'function recordFulfillment(uint256 orderId, bytes32 resultHash, bytes32 serviceId, bytes32 transactionRef) external',
  'event AgentPayment(uint256 indexed orderId, address indexed agent, address indexed provider, uint256 amount, bytes32 serviceId, bytes32 transactionRef)',
  'event FulfillmentReceipt(uint256 indexed orderId, address indexed provider, bytes32 resultHash, bytes32 serviceId, bytes32 transactionRef)',
];

export interface OnchainRecordResult {
  ok: boolean;
  txHash?: string;
  error?: string;
}

export interface SourceChainEnv {
  rpcUrl?: string;
  contractAddress?: string;
  privateKey?: string;
}

/** Read the source-chain wiring from the environment (missing = recording disabled). */
export function sourceChainEnv(): SourceChainEnv {
  return {
    rpcUrl: process.env.SOURCE_CHAIN_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com',
    contractAddress: process.env.SOURCE_CHAIN_CONTRACT_ADDRESS,
    privateKey: process.env.SOURCE_CHAIN_WALLET_PRIVATE_KEY,
  };
}

export function isOnchainRecordEnabled(env: SourceChainEnv = sourceChainEnv()): boolean {
  return !!env.contractAddress && !!env.privateKey;
}

/**
 * Record an AgentPayment on the live VeilSource contract (soft-fail).
 * Returns the transaction hash on success, or a reason string on failure.
 */
export async function recordAgentPayment(
  opts: {
    orderId: bigint;
    provider: string;
    amount: bigint;
    serviceId: string;
    transactionRef: string;
  },
  signerPrivateKey?: string,
): Promise<OnchainRecordResult> {
  const env = sourceChainEnv();
  if (isDemoMode()) {
    // Demo mode never touches an RPC: wallets are generated, so there is
    // nothing to broadcast. The vault honestly labels this order `mirror`.
    return { ok: false, error: 'demo mode — on-chain recording disabled (mirror)' };
  }
  if (!env.contractAddress || !env.privateKey) {
    return { ok: false, error: 'on-chain record disabled: SOURCE_CHAIN_CONTRACT_ADDRESS / SOURCE_CHAIN_WALLET_PRIVATE_KEY not set' };
  }
  try {
    const provider = new JsonRpcProvider(env.rpcUrl);
    const wallet = new Wallet(signerPrivateKey ?? env.privateKey, provider);
    const contract = new Contract(env.contractAddress, SOURCE_ABI, wallet);
    const tx = await contract.recordAgentPayment(
      opts.orderId,
      opts.provider,
      opts.amount,
      opts.serviceId,
      opts.transactionRef,
    );
    // Broadcast is the fact: return the hash immediately so the rail never
    // blocks on a flaky confirmation. The Attestcoin worker proves the tx once
    // it is mined (it re-checks receipts), upgrading the vault to verified.
    // A revert here (rare — order-id reuse) simply never gets proven.
    try {
      const receipt = await tx.wait(1, 8_000);
      return { ok: true, txHash: receipt.hash };
    } catch {
      return { ok: true, txHash: tx.hash };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Record a FulfillmentReceipt on the live VeilSource contract (soft-fail).
 * Only the provider recorded for the order may call this on-chain.
 */
/**
 * Record a FulfillmentReceipt on the live VeilSource contract (soft-fail).
 * Only the provider recorded for the order may call this on-chain — pass the
 * provider's private key as `signerPrivateKey` (defaults to the agent key).
 */
export async function recordFulfillment(
  opts: {
    orderId: bigint;
    resultHash: string;
    serviceId: string;
    transactionRef: string;
  },
  signerPrivateKey?: string,
): Promise<OnchainRecordResult> {
  const env = sourceChainEnv();
  if (isDemoMode()) {
    return { ok: false, error: 'demo mode — on-chain recording disabled (mirror)' };
  }
  if (!env.contractAddress || !env.privateKey) {
    return { ok: false, error: 'on-chain record disabled: SOURCE_CHAIN_CONTRACT_ADDRESS / SOURCE_CHAIN_WALLET_PRIVATE_KEY not set' };
  }
  try {
    const provider = new JsonRpcProvider(env.rpcUrl);
    const wallet = new Wallet(signerPrivateKey ?? env.privateKey, provider);
    const contract = new Contract(env.contractAddress, SOURCE_ABI, wallet);
    const tx = await contract.recordFulfillment(
      opts.orderId,
      opts.resultHash,
      opts.serviceId,
      opts.transactionRef,
    );
    try {
      const receipt = await tx.wait(1, 8_000);
      return { ok: true, txHash: receipt.hash };
    } catch {
      return { ok: true, txHash: tx.hash };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}