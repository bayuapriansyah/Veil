import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { generateZKReceipt, computeResultData, randomSalt } from './zk-prover';

describe('ZK Receipt Prover', () => {
  const orderId = 603001n;
  const providerAddress = '0xEaF93a771a5A85CeC590af8bd08983ABD3074814';
  const serviceId = 'market-data';

  it('generates a valid ZK proof with correct structure', async () => {
    const resultData = computeResultData('test-payload');
    const salt = randomSalt();
    const result = await generateZKReceipt(orderId, resultData, salt, providerAddress, serviceId);
    assert.equal(result.ok, true, `Proof generation failed: ${result.error}`);
    assert.ok(result.zkProofHash, 'zkProofHash should be set');
    assert.ok(result.proof, 'proof should be set');
    assert.ok(result.publicInputs, 'publicInputs should be set');
    assert.equal(result.publicInputs!.length, 4, 'should have 4 public signals');
    assert.equal(result.orderId, '603001');
    assert.ok(result.zkProofHash.startsWith('0x'), 'zkProofHash should be hex');
    assert.equal(result.zkProofHash.length, 66, 'zkProofHash should be 32 bytes hex');
  });

  it('generates valid Groth16 proof components', async () => {
    const resultData = computeResultData('groth16-test');
    const salt = randomSalt();
    const result = await generateZKReceipt(orderId + 1n, resultData, salt, providerAddress, serviceId);
    assert.equal(result.ok, true);
    assert.equal(result.proof!.a.length, 2, 'proof.a should have 2 elements');
    assert.equal(result.proof!.b.length, 2, 'proof.b should be 2x2 matrix');
    assert.equal(result.proof!.b[0].length, 2);
    assert.equal(result.proof!.b[1].length, 2);
    assert.equal(result.proof!.c.length, 2, 'proof.c should have 2 elements');
    assert.ok(result.proof!.a[0].length > 0, 'proof.a[0] non-empty');
    assert.ok(result.proof!.b[0][0].length > 0, 'proof.b[0][0] non-empty');
    assert.ok(result.proof!.c[0].length > 0, 'proof.c[0] non-empty');
  });

  it('produces deterministic zkProofHash for same inputs', async () => {
    const resultData = computeResultData('deterministic');
    const salt = 12345n;
    const r1 = await generateZKReceipt(orderId + 10n, resultData, salt, providerAddress, serviceId);
    const r2 = await generateZKReceipt(orderId + 10n, resultData, salt, providerAddress, serviceId);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r1.zkProofHash, r2.zkProofHash, 'same inputs should produce same zkProofHash');
  });

  it('different inputs produce different proofs', async () => {
    const r1 = await generateZKReceipt(100n, computeResultData('aaa'), randomSalt(), providerAddress, serviceId);
    const r2 = await generateZKReceipt(200n, computeResultData('bbb'), randomSalt(), providerAddress, serviceId);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.notEqual(r1.proof!.a[0], r2.proof!.a[0], 'different inputs should produce different proofs');
  });

  it('computeResultData is deterministic', () => {
    const a = computeResultData('payload');
    const b = computeResultData('payload');
    assert.equal(a, b, 'Same input should produce same result');
  });

  it('computeResultData produces different values for different inputs', () => {
    const a = computeResultData('payload-a');
    const b = computeResultData('payload-b');
    assert.notEqual(a, b, 'Different inputs should produce different results');
  });

  it('randomSalt produces different values', () => {
    const a = randomSalt();
    const b = randomSalt();
    assert.notEqual(a, b, 'Different salts should be produced');
  });

  it('full roundtrip with realistic AI inference inputs', async () => {
    const resultData = BigInt(ethers.keccak256(ethers.toUtf8Bytes('ai-inference-result')));
    const salt = randomSalt();
    const result = await generateZKReceipt(603099n, resultData, salt, providerAddress, 'ai-inference');
    assert.equal(result.ok, true, `Full roundtrip failed: ${result.error}`);
    assert.ok(result.zkProofHash.startsWith('0x'));
    assert.equal(result.zkProofHash.length, 66);
    assert.ok(result.proof!.a.length === 2);
    assert.ok(result.publicInputs!.length === 4);
  });

  it('multiple proofs can be generated sequentially', async () => {
    for (let i = 0; i < 5; i++) {
      const resultData = computeResultData(`batch-${i}`);
      const salt = randomSalt();
      const result = await generateZKReceipt(BigInt(700000 + i), resultData, salt, providerAddress, serviceId);
      assert.equal(result.ok, true, `Proof ${i} failed: ${result.error}`);
      assert.ok(result.zkProofHash.startsWith('0x'));
    }
  });
});
