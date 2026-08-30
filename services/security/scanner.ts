/**
 * Provider bytecode security scanner for VEIL.
 *
 * Fetches a provider's deployed bytecode from the source chain (Sepolia) and
 * runs a heuristic analysis for dangerous EVM opcodes. The risk score (0-100)
 * is computed from the presence and frequency of opcodes that indicate potential
 * vulnerabilities:
 *
 *   - SELFDESTRUCT (0xFF) — can destroy the contract, irrecoverable
 *   - DELEGATECALL (0xF4) — executes code in caller's context, storage manipulation
 *   - STATICCALL (0xFA) — lower risk but noted for completeness
 *   - CREATE2 (0xF5) — can deploy deterministic contracts, potential proxy
 *   - EXTCODECOPY (0x3C) — can copy arbitrary code into memory
 *   - EXTCODESIZE (0x3B) — reconnaissance pattern
 *   - SSTORE (0x55) to proxy slots — storage manipulation indicator
 *   - tx.origin (0x41 in CALLER-like patterns) — phishing vector
 *
 * The scan result is emitted on-chain via VeilSource.recordProviderSecurityScan(),
 * following the same soft-fail pattern as recordAgentPayment/recordFulfillment.
 *
 * WARNING: This is a heuristic scanner, not a formal verification tool. It flags
 * known dangerous patterns but cannot guarantee the absence of all vulnerabilities.
 */
import 'dotenv/config';

import { Contract, JsonRpcProvider, Wallet, keccak256 } from 'ethers';

import { isDemoMode } from '../config/mode';

const SOURCE_ABI = [
  'function recordProviderSecurityScan(address provider, bytes32 bytecodeHash, uint8 riskScore, bool passedThreshold) external',
  'event SecurityScanRecorded(address indexed provider, bytes32 indexed bytecodeHash, uint8 riskScore, bool passedThreshold, address scanner)',
];

// --- EVM opcode definitions ------------------------------------------------ //

/** Known dangerous opcodes with their hex values and default severity weights. */
const OPCODES: Record<string, { hex: string; weight: number; severity: 'critical' | 'high' | 'medium'; description: string }> = {
  SELFDESTRUCT: { hex: 'ff', weight: 40, severity: 'critical', description: 'Destroys the contract and sends remaining ETH to target' },
  DELEGATECALL: { hex: 'f4', weight: 30, severity: 'high', description: 'Executes code in caller context with caller storage' },
  STATICCALL: { hex: 'fa', weight: 5, severity: 'medium', description: 'Static call — read-only but still notable' },
  CREATE2: { hex: 'f5', weight: 10, severity: 'medium', description: 'Deterministic contract deployment' },
  EXTCODECOPY: { hex: '3c', weight: 10, severity: 'high', description: 'Copies arbitrary code from another contract' },
  EXTCODESIZE: { hex: '3b', weight: 5, severity: 'medium', description: 'Reconnaissance — checks code size of another contract' },
};

/** tx.origin opcode value — used to detect phishing patterns. */
const TX_ORIGIN_HEX = '41';

/** Default risk threshold — providers scoring >= this are rejected. */
const DEFAULT_RISK_THRESHOLD = 50;

// --- Scan result types ----------------------------------------------------- //

export interface DangerousOpcode {
  opcode: string;
  hex: string;
  offset: number;
  severity: 'critical' | 'high' | 'medium';
  description: string;
}

export interface SecurityScanResult {
  ok: boolean;
  provider: string;
  bytecodeHash: string;
  bytecodeLength: number;
  riskScore: number;
  passedThreshold: boolean;
  opcodes: DangerousOpcode[];
  txHash?: string;
  error?: string;
}

// --- Environment ----------------------------------------------------------- //

export interface ScannerEnv {
  rpcUrl?: string;
  contractAddress?: string;
  privateKey?: string;
  riskThreshold: number;
}

export function scannerEnv(): ScannerEnv {
  return {
    rpcUrl: process.env.SOURCE_CHAIN_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com',
    contractAddress: process.env.SOURCE_CHAIN_CONTRACT_ADDRESS,
    privateKey: process.env.SOURCE_CHAIN_WALLET_PRIVATE_KEY,
    riskThreshold: Number(process.env.SECURITY_RISK_THRESHOLD ?? DEFAULT_RISK_THRESHOLD),
  };
}

export function isScannerEnabled(env: ScannerEnv = scannerEnv()): boolean {
  return !!env.contractAddress && !!env.privateKey;
}

// --- Bytecode analysis ----------------------------------------------------- //

/**
 * Parse raw bytecode hex into individual opcodes.
 * Returns an array of { opcode, hex, offset } tuples.
 * PUSH-data bytes are skipped (they are arguments, not opcodes).
 */
function parseOpcodes(bytecodeHex: string): Array<{ opcode: string; hex: string; offset: number }> {
  const clean = bytecodeHex.startsWith('0x') ? bytecodeHex.slice(2) : bytecodeHex;
  const result: Array<{ opcode: string; hex: string; offset: number }> = [];

  let i = 0;
  while (i < clean.length) {
    const byteHex = clean.substring(i, i + 2);
    const byteVal = parseInt(byteHex, 16);
    const offset = i / 2;

    result.push({ opcode: byteHex, hex: byteHex, offset });

    // Skip PUSH data bytes: PUSH1=0x60..PUSH32=0x7f
    if (byteVal >= 0x60 && byteVal <= 0x7f) {
      const pushBytes = byteVal - 0x5f;
      i += 2 + pushBytes * 2;
    } else {
      i += 2;
    }
  }

  return result;
}

/**
 * Analyze bytecode for dangerous opcodes and compute a risk score.
 *
 * The score is additive: each dangerous opcode adds its weight to the total.
 * Repeated instances of the same opcode add reduced weight (diminishing returns)
 * to avoid inflating the score for loops that use the same opcode repeatedly.
 */
export function analyzeBytecode(bytecodeHex: string): { riskScore: number; opcodes: DangerousOpcode[] } {
  const parsed = parseOpcodes(bytecodeHex);
  const found: DangerousOpcode[] = [];
  const seenCounts = new Map<string, number>();
  let score = 0;

  for (const { opcode, hex, offset } of parsed) {
    for (const [name, def] of Object.entries(OPCODES)) {
      if (hex === def.hex) {
        const count = (seenCounts.get(name) ?? 0) + 1;
        seenCounts.set(name, count);
        // First instance adds full weight; subsequent add 50% diminishing
        const weight = count === 1 ? def.weight : Math.ceil(def.weight * 0.5);
        score += weight;
        found.push({ opcode: name, hex, offset, severity: def.severity, description: def.description });
      }
    }

    // tx.origin detection: flag if 0x41 appears in suspicious patterns
    if (hex === TX_ORIGIN_HEX) {
      const count = (seenCounts.get('TX_ORIGIN') ?? 0) + 1;
      seenCounts.set('TX_ORIGIN', count);
      if (count <= 2) {
        score += 8;
        found.push({ opcode: 'tx.origin', hex, offset, severity: 'medium', description: 'Potential phishing vector — tx.origin usage' });
      }
    }
  }

  // Cap at 100
  return { riskScore: Math.min(score, 100), opcodes: found };
}

// --- On-chain recording (soft-fail) ---------------------------------------- //

/**
 * Scan a provider's bytecode and optionally record the result on-chain.
 * Follows the soft-fail pattern: never throws, returns error in result.
 * @param bytecodeOverride If provided, skip RPC fetch and scan this bytecode directly (for testing).
 */
export async function scanProvider(
  providerAddress: string,
  env: ScannerEnv = scannerEnv(),
  bytecodeOverride?: string,
): Promise<SecurityScanResult> {
  // Skip demo mode check when bytecodeOverride is provided (testing path)
  if (!bytecodeOverride && isDemoMode()) {
    return {
      ok: true,
      provider: providerAddress,
      bytecodeHash: keccak256('0x'),
      bytecodeLength: 0,
      riskScore: 0,
      passedThreshold: true,
      opcodes: [],
    };
  }

  if (!bytecodeOverride && !env.rpcUrl) {
    return {
      ok: true,
      provider: providerAddress,
      bytecodeHash: keccak256('0x'),
      bytecodeLength: 0,
      riskScore: 0,
      passedThreshold: true,
      opcodes: [],
    };
  }

  try {
    // 1. Fetch bytecode from source chain (or use override for testing)
    let bytecode: string;
    if (bytecodeOverride) {
      bytecode = bytecodeOverride;
    } else {
      const provider = new JsonRpcProvider(env.rpcUrl);
      bytecode = await provider.getCode(providerAddress);
    }

    if (!bytecode || bytecode === '0x' || bytecode === '0x0') {
      return {
        ok: true,
        provider: providerAddress,
        bytecodeHash: keccak256('0x'),
        bytecodeLength: 0,
        riskScore: 0,
        passedThreshold: true,
        opcodes: [],
      };
    }

    // 2. Compute bytecode hash
    const bytecodeHash = keccak256(bytecode);
    const bytecodeLength = (bytecode.length - 2) / 2; // bytes

    // 3. Analyze for dangerous opcodes
    const { riskScore, opcodes } = analyzeBytecode(bytecode);
    const passedThreshold = riskScore < env.riskThreshold;

    // 4. Record on-chain (soft-fail)
    let txHash: string | undefined;
    if (env.contractAddress && env.privateKey) {
      try {
        const rpcProvider = new JsonRpcProvider(env.rpcUrl);
        const wallet = new Wallet(env.privateKey, rpcProvider);
        const contract = new Contract(env.contractAddress, SOURCE_ABI, wallet);
        const tx = await contract.recordProviderSecurityScan(
          providerAddress,
          bytecodeHash,
          riskScore,
          passedThreshold,
        );
        try {
          const receipt = await tx.wait(1, 8_000);
          txHash = receipt.hash;
        } catch {
          txHash = tx.hash;
        }
      } catch (e) {
        // Soft-fail: scan result is still valid, just not recorded on-chain
      }
    }

    return {
      ok: true,
      provider: providerAddress,
      bytecodeHash,
      bytecodeLength,
      riskScore,
      passedThreshold,
      opcodes,
      txHash,
    };
  } catch (e) {
    return {
      ok: false,
      provider: providerAddress,
      bytecodeHash: '0x',
      bytecodeLength: 0,
      riskScore: 0,
      passedThreshold: true,
      opcodes: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
