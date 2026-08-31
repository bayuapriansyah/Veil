import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCommitment, generateSalt } from './crypto';
import { keccak256, toUtf8Bytes } from 'ethers';

const PROVIDER = '0xEaF93a771a5A85CeC590af8bd08983ABD3074814';
const AMOUNT = 50000000000000000n; // 0.05 CTC
const SERVICE_ID = keccak256(toUtf8Bytes('market-data'));
const SALT = '0xabababababababababababababababababababababababababababababababab';

describe('computeCommitment', () => {
  it('matches pre-computed test vector V1', () => {
    const c = computeCommitment(PROVIDER, AMOUNT, SERVICE_ID, SALT);
    assert.equal(c, '0x4dc852c992bbd9e81bed8af77c8bebf600ceef18c4e3cb3db4fd1983229d7d33');
  });

  it('changes when amount changes (V2)', () => {
    const c = computeCommitment(PROVIDER, 100000000000000000n, SERVICE_ID, SALT);
    assert.equal(c, '0x35ac574e61020585d045f9256736256fbe461f5691f255c36eba69e0c03f5020');
  });

  it('changes when provider changes (V3)', () => {
    const diffProvider = '0x836b911ca0027019452ffada52fc08403dc3475276e10658bee0096fda1c1fe9'.slice(0, 42);
    const c = computeCommitment(diffProvider, AMOUNT, SERVICE_ID, SALT);
    assert.equal(c, '0xb9244c0393e0e3d91c7443022d22987f980c922db9fe5251d02bccfd24c23eba');
  });

  it('changes when salt changes (V4)', () => {
    const diffSalt = '0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd';
    const c = computeCommitment(PROVIDER, AMOUNT, SERVICE_ID, diffSalt);
    assert.equal(c, '0xef44521e6aab0d2f3a4538e529ee764e5d236f0b15f5cf47d4d22a0619b5602e');
  });

  it('is deterministic — same inputs produce same commitment', () => {
    const c1 = computeCommitment(PROVIDER, AMOUNT, SERVICE_ID, SALT);
    const c2 = computeCommitment(PROVIDER, AMOUNT, SERVICE_ID, SALT);
    assert.equal(c1, c2);
  });

  it('accepts amount as string', () => {
    const c = computeCommitment(PROVIDER, '50000000000000000', SERVICE_ID, SALT);
    assert.equal(c, '0x4dc852c992bbd9e81bed8af77c8bebf600ceef18c4e3cb3db4fd1983229d7d33');
  });

  it('generates unique salts', () => {
    const s1 = generateSalt();
    const s2 = generateSalt();
    assert.equal(s1.length, 66); // 0x + 64 hex chars
    assert.notEqual(s1, s2);
  });
});
