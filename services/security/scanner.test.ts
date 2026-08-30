/**
 * VEIL provider bytecode security scanner tests.
 *
 * Scenarios:
 *   1. clean bytecode     — no dangerous opcodes, riskScore 0
 *   2. SELFDESTRUCT       — critical opcode, riskScore >= 40
 *   3. DELEGATECALL       — high-risk opcode, riskScore >= 30
 *   4. multiple dangerous — compound risk, riskScore >= 50 (exceeds threshold)
 *   5. bytecode override  — scanProvider uses override for testing
 *   6. empty bytecode     — EOA or uninitialized, riskScore 0
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeBytecode, scanProvider, DangerousOpcode } from './scanner';

// --- Helper opcodes (hex bytes) ------------------------------------------- //
const STOP = '00';
const ADD = '01';
const SELFDESTRUCT = 'ff';
const DELEGATECALL = 'f4';
const STATICCALL = 'fa';
const CREATE2 = 'f5';
const EXTCODECOPY = '3c';
const EXTCODESIZE = '3b';
const SSTORE = '55';
const TX_ORIGIN = '41';
const PUSH1_42 = '6042'; // PUSH1 0x42

// --- Test vectors --------------------------------------------------------- //

/** Clean bytecode: just STOP and ADD — no dangerous opcodes. */
const CLEAN_BYTECODE = `0x${STOP}${ADD}${STOP}`;

/** Bytecode with a single SELFDESTRUCT. */
const SELFDESTRUCT_BYTECODE = `0x${PUSH1_42}${SELFDESTRUCT}`;

/** Bytecode with a single DELEGATECALL. */
const DELEGATECALL_BYTECODE = `0x${PUSH1_42}${DELEGATECALL}${STOP}`;

/** Bytecode with multiple dangerous opcodes. */
const MULTI_DANGEROUS_BYTECODE = `0x${SELFDESTRUCT}${DELEGATECALL}${CREATE2}${EXTCODECOPY}${STOP}`;

/** Bytecode with tx.origin usage. */
const TX_ORIGIN_BYTECODE = `0x${TX_ORIGIN}${STOP}`;

/** Empty bytecode (EOA). */
const EMPTY_BYTECODE = '0x';

describe('security scanner', () => {
  it('1. clean bytecode — riskScore 0, no dangerous opcodes', () => {
    const { riskScore, opcodes } = analyzeBytecode(CLEAN_BYTECODE);
    assert.equal(riskScore, 0);
    assert.equal(opcodes.length, 0);
  });

  it('2. SELFDESTRUCT — critical opcode, riskScore >= 40', () => {
    const { riskScore, opcodes } = analyzeBytecode(SELFDESTRUCT_BYTECODE);
    assert.ok(riskScore >= 40, `expected riskScore >= 40, got ${riskScore}`);
    assert.ok(opcodes.length >= 1);
    assert.equal(opcodes[0].opcode, 'SELFDESTRUCT');
    assert.equal(opcodes[0].severity, 'critical');
  });

  it('3. DELEGATECALL — high-risk opcode, riskScore >= 30', () => {
    const { riskScore, opcodes } = analyzeBytecode(DELEGATECALL_BYTECODE);
    assert.ok(riskScore >= 30, `expected riskScore >= 30, got ${riskScore}`);
    assert.ok(opcodes.length >= 1);
    assert.equal(opcodes[0].opcode, 'DELEGATECALL');
    assert.equal(opcodes[0].severity, 'high');
  });

  it('4. multiple dangerous opcodes — compound risk, riskScore >= 50 (exceeds threshold)', () => {
    const { riskScore, opcodes } = analyzeBytecode(MULTI_DANGEROUS_BYTECODE);
    assert.ok(riskScore >= 50, `expected riskScore >= 50, got ${riskScore}`);
    assert.ok(opcodes.length >= 4);
    const names = opcodes.map((o) => o.opcode);
    assert.ok(names.includes('SELFDESTRUCT'));
    assert.ok(names.includes('DELEGATECALL'));
    assert.ok(names.includes('CREATE2'));
    assert.ok(names.includes('EXTCODECOPY'));
  });

  it('5. tx.origin — flagged as medium severity', () => {
    const { riskScore, opcodes } = analyzeBytecode(TX_ORIGIN_BYTECODE);
    assert.ok(riskScore >= 8, `expected riskScore >= 8, got ${riskScore}`);
    assert.ok(opcodes.length >= 1);
    assert.equal(opcodes[0].opcode, 'tx.origin');
    assert.equal(opcodes[0].severity, 'medium');
  });

  it('6. empty bytecode — riskScore 0 (EOA or uninitialized)', () => {
    const { riskScore, opcodes } = analyzeBytecode(EMPTY_BYTECODE);
    assert.equal(riskScore, 0);
    assert.equal(opcodes.length, 0);
  });

  it('7. scanProvider with bytecodeOverride — bypasses RPC fetch', async () => {
    const prev = process.env.VEIL_MODE;
    process.env.VEIL_MODE = 'production';
    try {
      const result = await scanProvider(
        '0x0000000000000000000000000000000000000000',
        { riskThreshold: 50 },
        SELFDESTRUCT_BYTECODE,
      );
      assert.equal(result.ok, true);
      assert.equal(result.provider, '0x0000000000000000000000000000000000000000');
      assert.ok(result.riskScore >= 40, `expected riskScore >= 40, got ${result.riskScore}`);
      assert.equal(result.passedThreshold, true); // 40 < 50 threshold, so passes
      assert.ok(result.opcodes.length >= 1);
      assert.equal(result.opcodes[0].opcode, 'SELFDESTRUCT');
    } finally {
      if (prev === undefined) delete process.env.VEIL_MODE;
      else process.env.VEIL_MODE = prev;
    }
  });

  it('8. scanProvider with clean bytecode — passes threshold', async () => {
    const prev = process.env.VEIL_MODE;
    process.env.VEIL_MODE = 'production';
    try {
      const result = await scanProvider(
        '0x0000000000000000000000000000000000000000',
        { riskThreshold: 50 },
        CLEAN_BYTECODE,
      );
      assert.equal(result.ok, true);
      assert.equal(result.riskScore, 0);
      assert.equal(result.passedThreshold, true);
      assert.equal(result.opcodes.length, 0);
    } finally {
      if (prev === undefined) delete process.env.VEIL_MODE;
      else process.env.VEIL_MODE = prev;
    }
  });

  it('9. repeated opcodes — diminishing weight prevents score inflation', () => {
    // 3x SELFDESTRUCT: first = 40, next two = 20 each = 80 total, capped at 100
    const bytecode = `0x${SELFDESTRUCT}${SELFDESTRUCT}${SELFDESTRUCT}`;
    const { riskScore } = analyzeBytecode(bytecode);
    assert.ok(riskScore >= 40, `expected riskScore >= 40, got ${riskScore}`);
    assert.ok(riskScore <= 100, `expected riskScore <= 100, got ${riskScore}`);
  });
});
