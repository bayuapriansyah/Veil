import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ethers } from 'ethers';
import { fork } from 'node:child_process';

export interface ZKProofResult {
  ok: boolean;
  orderId: string;
  zkProofHash: string;
  proof?: { a: [string, string]; b: [[string, string], [string, string]]; c: [string, string] };
  publicInputs?: string[];
  error?: string;
}

let _wasmBuffer: Buffer | null = null;
let _zkeyBuffer: Buffer | null = null;

function loadCircuitArtifacts(): { wasm: Buffer; zkey: Buffer } {
  if (_wasmBuffer && _zkeyBuffer) return { wasm: _wasmBuffer, zkey: _zkeyBuffer };

  const root = findProjectRoot();
  const circuitsDir = join(root, 'circuits');
  const wasmPath = join(circuitsDir, 'zk-receipt.wasm');
  const zkeyPath = join(circuitsDir, 'zk-receipt_final.zkey');

  if (!existsSync(wasmPath)) throw new Error(`Circuit WASM not found: ${wasmPath}`);
  if (!existsSync(zkeyPath)) throw new Error(`Proving key not found: ${zkeyPath}`);

  _wasmBuffer = readFileSync(wasmPath);
  _zkeyBuffer = readFileSync(zkeyPath);
  return { wasm: _wasmBuffer, zkey: _zkeyBuffer };
}

function findProjectRoot(): string {
  const cwd = process.cwd();
  if (existsSync(join(cwd, 'circuits'))) return cwd;
  if (existsSync(join(cwd, '..', 'circuits'))) return join(cwd, '..');
  return cwd;
}

function forkProver(input: { orderId: string; resultData: string; salt: string; providerAddress: string; serviceId: string }): Promise<{ ok: boolean; proof?: any; publicSignals?: string[]; error?: string }> {
  return new Promise((resolve) => {
    const root = findProjectRoot();
    const workerPath = join(root, 'services', 'security', 'zk-prover-worker.js');
    const child = fork(workerPath, { cwd: root, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, error: 'snarkjs prover process timed out after 30s' });
    }, 30_000);

    child.on('message', (msg: any) => {
      clearTimeout(timer);
      resolve(msg);
      child.kill();
    });

    child.on('close', () => { clearTimeout(timer); });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });

    child.send(input);
  });
}

export async function generateZKReceipt(
  orderId: bigint,
  resultData: bigint,
  salt: bigint,
  providerAddress: string,
  serviceId: string,
): Promise<ZKProofResult> {
  const orderIdStr = orderId.toString();

  try {
    loadCircuitArtifacts();

    const result = await forkProver({
      orderId: orderIdStr,
      resultData: resultData.toString(),
      salt: salt.toString(),
      providerAddress,
      serviceId,
    });

    if (!result.ok || !result.proof) {
      return { ok: false, orderId: orderIdStr, zkProofHash: '', error: result.error ?? 'proof generation failed' };
    }

    const { proof, publicSignals } = result;
    const zkProofHashDec = publicSignals![3];
    const zkProofHash = '0x' + BigInt(zkProofHashDec).toString(16).padStart(64, '0');

    const proofA: [string, string] = [proof.pi_a[0], proof.pi_a[1]];
    const proofB: [[string, string], [string, string]] = [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ];
    const proofC: [string, string] = [proof.pi_c[0], proof.pi_c[1]];

    return {
      ok: true,
      orderId: orderIdStr,
      zkProofHash,
      proof: { a: proofA, b: proofB, c: proofC },
      publicInputs: publicSignals,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, orderId: orderIdStr, zkProofHash: '', error };
  }
}

export async function verifyZKProof(
  proof: { a: [string, string]; b: [[string, string], [string, string]]; c: [string, string] },
  publicInputs: string[],
): Promise<boolean> {
  try {
    const snarkjs = await import('snarkjs');
    const { zkey } = loadCircuitArtifacts();
    const root = findProjectRoot();
    const vKey = JSON.parse(readFileSync(join(root, 'circuits', 'verification_key.json'), 'utf8'));
    return await snarkjs.groth16.verify(vKey, publicInputs, proof);
  } catch {
    return false;
  }
}

export function computeResultData(payloadRef: string): bigint {
  return BigInt(ethers.keccak256(ethers.toUtf8Bytes(payloadRef)));
}

export function randomSalt(): bigint {
  return BigInt(ethers.hexlify(ethers.randomBytes(32)));
}
