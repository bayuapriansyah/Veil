import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isDemoMode, resolveVeilMode } from './mode';

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('resolveVeilMode: explicit VEIL_MODE=demo wins even with live keys', () => {
  withEnv(
    {
      VEIL_MODE: 'demo',
      SOURCE_CHAIN_WALLET_PRIVATE_KEY: '0x1111111111111111111111111111111111111111111111111111111111111111',
      SOURCE_CHAIN_CONTRACT_ADDRESS: '0xbe2d0793344e656690be44b81128BbF0EDa6F93c',
    },
    () => assert.equal(resolveVeilMode(), 'demo'),
  );
});

test('resolveVeilMode: explicit VEIL_MODE=production wins', () => {
  withEnv({ VEIL_MODE: 'production' }, () => assert.equal(resolveVeilMode(), 'production'));
});

test('resolveVeilMode: auto-detect production when live keys + contract present', () => {
  withEnv(
    {
      VEIL_MODE: undefined,
      SOURCE_CHAIN_WALLET_PRIVATE_KEY: '0x1111111111111111111111111111111111111111111111111111111111111111',
      SOURCE_CHAIN_CONTRACT_ADDRESS: '0xbe2d0793344e656690be44b81128BbF0EDa6F93c',
    },
    () => assert.equal(resolveVeilMode(), 'production'),
  );
});

test('resolveVeilMode: auto-detect demo when keys missing (zero-setup)', () => {
  withEnv(
    {
      VEIL_MODE: undefined,
      SOURCE_CHAIN_WALLET_PRIVATE_KEY: undefined,
      SOURCE_CHAIN_CONTRACT_ADDRESS: undefined,
    },
    () => {
      assert.equal(resolveVeilMode(), 'demo');
      assert.equal(isDemoMode(), true);
    },
  );
});