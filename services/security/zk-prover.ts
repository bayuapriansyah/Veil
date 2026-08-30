import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ethers } from 'ethers';

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

  const circuitsDir = join(process.cwd(), 'circuits');
  const wasmPath = join(circuitsDir, 'zk-receipt.wasm');
  const zkeyPath = join(circuitsDir, 'zk-receipt_final.zkey');

  if (!existsSync(wasmPath)) throw new Error(`Circuit WASM not found: ${wasmPath}`);
  if (!existsSync(zkeyPath)) throw new Error(`Proving key not found: ${zkeyPath}`);

  _wasmBuffer = readFileSync(wasmPath);
  _zkeyBuffer = readFileSync(zkeyPath);
  return { wasm: _wasmBuffer, zkey: _zkeyBuffer };
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
    const snarkjs = await import('snarkjs');

    const { wasm, zkey } = loadCircuitArtifacts();

    const input = {
      resultData: resultData.toString(),
      salt: salt.toString(),
      orderId: orderId.toString(),
      provider: BigInt(providerAddress).toString(),
      serviceId: ethers.keccak256(ethers.toUtf8Bytes(serviceId)),
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);

    const zkProofHashDec = publicSignals[3];
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
    const vKey = JSON.parse(readFileSync(join(process.cwd(), 'circuits', 'verification_key.json'), 'utf8'));
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
