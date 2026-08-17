/**
 * Tests for the REAL x402 component — `exact`/EIP-3009 scheme.
 *
 * These tests verify the actual x402 cryptographic protocol agreement:
 *  - the EIP-3009 EIP-712 digest is constructed per the spec,
 *  - the payer signs it,
 *  - the server ECRECOVERs the signer and validates amount/payTo.
 *
 * No live token/chain is used and NO settlement is claimed. These tests prove
 * the protocol mechanics are implemented correctly, offline.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';

import {
  buildUsdcRequirement,
  signExactPayment,
  verifyExactPayment,
  computeTransferAuthorizationDigest,
} from '../provider/x402';
import { EIP3009Authorization } from '../provider/types';

const PAYER_KEY = '0x' + 'aa'.repeat(32);
const PAYER = new Wallet(PAYER_KEY).address;
const PAY_TO = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C'; // documented example payTo
const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // documented example asset
const CHAIN_ID = 84532;
const NONCE_01 = '0x' + '01'.repeat(32);

const DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: CHAIN_ID,
  verifyingContract: USDC_BASE_SEPOLIA,
};

describe('x402 exact/EIP-3009 (real protocol component)', () => {
  it('builds a spec-conformant PaymentRequirement', () => {
    const req = buildUsdcRequirement({
      payTo: PAY_TO,
      amountAtoms: '10000',
      resource: 'https://api.example.com/market-data',
      description: 'VEIL market data',
      chainId: CHAIN_ID,
      usdcAddress: USDC_BASE_SEPOLIA,
    });
    assert.equal(req.scheme, 'exact');
    assert.equal(req.network, `eip155:${CHAIN_ID}`);
    assert.equal(req.maxAmountRequired, '10000');
    assert.equal(req.asset, USDC_BASE_SEPOLIA);
    assert.equal(req.payTo, PAY_TO);
  });

  it('signs an EIP-3009 transferWithAuthorization and verifies via ECRECOVER', () => {
    const nonce = '0x' + 'ef'.repeat(32);
    const validAfter = '1740672089';
    const validBefore = '1740672154';

    const { payload, digest } = signExactPayment(
      { domain: DOMAIN, payerKey: PAYER_KEY, to: PAY_TO, value: '10000', validAfter, validBefore, nonce },
      'https://api.example.com/market-data',
      'VEIL market data',
      buildUsdcRequirement({
        payTo: PAY_TO,
        amountAtoms: '10000',
        resource: 'https://api.example.com/market-data',
        description: 'VEIL market data',
        chainId: CHAIN_ID,
        usdcAddress: USDC_BASE_SEPOLIA,
      }),
    );

    assert.equal(payload.payload.authorization.from, PAYER);
    assert.equal(payload.payload.authorization.to, PAY_TO);

    const result = verifyExactPayment(payload, PAY_TO, '10000');
    assert.equal(result.ok, true, result.error);
    assert.equal(result.payer, PAYER);

    // Digest determinism: the server recomputes the same digest.
    const recomputed = computeTransferAuthorizationDigest(DOMAIN, payload.payload.authorization);
    assert.equal(recomputed, digest);
  });

  it('rejects a payload whose payTo does not match the requirement', () => {
    const { payload } = signExactPayment(
      { domain: DOMAIN, payerKey: PAYER_KEY, to: '0x' + '77'.repeat(20), value: '10000', validAfter: '1', validBefore: '2', nonce: NONCE_01 },
      'https://api.example.com/market-data',
      'VEIL market data',
      buildUsdcRequirement({
        payTo: PAY_TO,
        amountAtoms: '10000',
        resource: 'https://api.example.com/market-data',
        description: 'VEIL market data',
        chainId: CHAIN_ID,
        usdcAddress: USDC_BASE_SEPOLIA,
      }),
    );
    const result = verifyExactPayment(payload, PAY_TO, '10000');
    assert.equal(result.ok, false);
  });

  it('rejects an amount below the requirement', () => {
    const { payload } = signExactPayment(
      { domain: DOMAIN, payerKey: PAYER_KEY, to: PAY_TO, value: '1', validAfter: '1', validBefore: '2', nonce: NONCE_01 },
      'https://api.example.com/market-data',
      'VEIL market data',
      buildUsdcRequirement({
        payTo: PAY_TO,
        amountAtoms: '10000',
        resource: 'https://api.example.com/market-data',
        description: 'VEIL market data',
        chainId: CHAIN_ID,
        usdcAddress: USDC_BASE_SEPOLIA,
      }),
    );
    const result = verifyExactPayment(payload, PAY_TO, '10000');
    assert.equal(result.ok, false);
  });

it('rejects a tampered signature (recovery mismatch)', () => {
    const authorization: EIP3009Authorization = {
      from: '0x' + '11'.repeat(20),
      to: PAY_TO,
      value: '10000',
      validAfter: '1',
      validBefore: '2',
      nonce: NONCE_01,
    };
    // Sign the digest with a DIFFERENT key than `from`, so ECRECOVER recovers
    // a different address than the claimed payer.
    const otherWallet = new Wallet('0x' + 'bb'.repeat(32));
    const digest = computeTransferAuthorizationDigest(DOMAIN, authorization);
    const wrongSig = otherWallet.signingKey.sign(digest).serialized;
    const result = verifyExactPayment(
      {
        x402Version: 2,
        resource: { url: 'x' },
        accepted: {
          scheme: 'exact',
          network: `eip155:${CHAIN_ID}`,
          amount: '10000',
          asset: USDC_BASE_SEPOLIA,
          payTo: PAY_TO,
          maxTimeoutSeconds: 60,
          extra: { name: 'USD Coin', version: '2', assetTransferMethod: 'eip3009' },
        },
        payload: { signature: wrongSig, authorization: { ...authorization, nonce: NONCE_01 } },
      },
      PAY_TO,
      '10000',
    );
    assert.equal(result.ok, false);
  });
});
