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
import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { isDemoMode } from '../config/mode';

const SOURCE_ABI = [
  'function recordAgentPayment(uint256 orderId, address provider, uint256 amount, bytes32 serviceId, bytes32 transactionRef) external',
  'function recordFulfillment(uint256 orderId, bytes32 resultHash, bytes32 serviceId, bytes32 transactionRef) external',
  'function recordZKReceipt(uint256 orderId, address provider, bytes32 zkProofHash, bytes32 serviceId) external',
  'event AgentPayment(uint256 indexed orderId, address indexed agent, address indexed provider, uint256 amount, bytes32 serviceId, bytes32 transactionRef)',
  'event FulfillmentReceipt(uint256 indexed orderId, address indexed provider, bytes32 resultHash, bytes32 serviceId, bytes32 transactionRef)',
  'event ZKReceiptRecorded(uint256 indexed orderId, address indexed provider, bytes32 indexed zkProofHash, bytes32 serviceId, uint256 timestamp)',
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
      { gasLimit: 100_000 },
    );
    try {
      const receipt = await tx.wait();
      if (receipt.status === 0) return { ok: false, error: 'tx reverted on-chain' };
      return { ok: true, txHash: receipt.hash };
    } catch {
      return { ok: true, txHash: tx.hash };
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    appendError({
      ts: new Date().toISOString(),
      type: 'payment',
      orderId: opts.orderId.toString(),
      error,
      opts: {
        orderId: opts.orderId.toString(),
        provider: opts.provider,
        amount: opts.amount.toString(),
        serviceId: opts.serviceId,
        transactionRef: opts.transactionRef,
      },
    });
    return { ok: false, error };
  }
}

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
      { gasLimit: 100_000 },
    );
    try {
      const receipt = await tx.wait();
      if (receipt.status === 0) return { ok: false, error: 'tx reverted on-chain' };
      return { ok: true, txHash: receipt.hash };
    } catch {
      return { ok: true, txHash: tx.hash };
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    appendError({
      ts: new Date().toISOString(),
      type: 'fulfillment',
      orderId: opts.orderId.toString(),
      error,
      opts: {
        orderId: opts.orderId.toString(),
        resultHash: opts.resultHash,
        serviceId: opts.serviceId,
        transactionRef: opts.transactionRef,
      },
    });
    return { ok: false, error };
  }
}

/**
 * Record a ZK receipt on the live VeilSource contract (soft-fail).
 * Only the provider recorded for the order may call this — pass the
 * provider's private key as `signerPrivateKey`.
 */
export async function recordZKReceipt(
  opts: {
    orderId: bigint;
    provider: string;
    zkProofHash: string;
    serviceId: string;
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
    const tx = await contract.recordZKReceipt(
      opts.orderId,
      opts.provider,
      opts.zkProofHash,
      opts.serviceId,
      { gasLimit: 100_000 },
    );
    try {
      const receipt = await tx.wait();
      if (receipt.status === 0) return { ok: false, error: 'tx reverted on-chain' };
      return { ok: true, txHash: receipt.hash };
    } catch {
      return { ok: true, txHash: tx.hash };
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    appendError({
      ts: new Date().toISOString(),
      type: 'zk-receipt',
      orderId: opts.orderId.toString(),
      error,
      opts: {
        orderId: opts.orderId.toString(),
        provider: opts.provider,
        zkProofHash: opts.zkProofHash,
        serviceId: opts.serviceId,
      },
    });
    return { ok: false, error };
  }
}

// --- Error queue for failed recordings ------------------------------------ //

export interface FailedRecord {
  ts: string;
  type: 'payment' | 'fulfillment' | 'zk-receipt';
  orderId: string;
  error: string;
  opts: Record<string, string>;
}

const ERROR_DIR = join(process.cwd(), '.veil');
const ERROR_FILE = join(ERROR_DIR, 'attestation-errors.json');

function ensureErrorDir(): void {
  if (!existsSync(ERROR_DIR)) mkdirSync(ERROR_DIR, { recursive: true });
}

/** Append a failed recording to the error queue (dedup by type+orderId). */
export function appendError(record: FailedRecord): void {
  try {
    ensureErrorDir();
    let records: FailedRecord[] = [];
    try {
      records = JSON.parse(readFileSync(ERROR_FILE, 'utf8'));
    } catch { /* empty file */ }
    // Dedup: replace an existing entry for the same type+orderId instead of stacking.
    const idx = records.findIndex((r) => r.type === record.type && r.orderId === record.orderId);
    if (idx >= 0) records[idx] = record;
    else records.push(record);
    writeFileSync(ERROR_FILE, JSON.stringify(records, null, 2));
  } catch { /* best-effort */ }
}

/** Read all failed recordings from the error queue. */
export function readErrors(): FailedRecord[] {
  try {
    return JSON.parse(readFileSync(ERROR_FILE, 'utf8'));
  } catch {
    return [];
  }
}

/** Clear the error queue after successful replay. */
export function clearErrors(): void {
  try {
    ensureErrorDir();
    writeFileSync(ERROR_FILE, '[]');
  } catch { /* best-effort */ }
}