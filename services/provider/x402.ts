/**
 * REAL x402 component — `exact` scheme on EVM (EIP-3009 asset transfer method).
 *
 * Implements the x402 protocol faithfully:
 *  - Builds `PaymentRequirement` / 402 response bodies per the spec.
 *  - Client side: constructs the EIP-3009 `transferWithAuthorization`
 *    EIP-712 digest and signs it with the agent's wallet.
 *  - Server side: verifies the signature by recovering the signer and ECRECOVER,
 *    checks the authorization window/amount against the required payment.
 *
 * IMPORTANT: this component implements the protocol's CRYPTOGRAPHIC agreement.
 * It does NOT perform on-chain settlement (no live USDC/EVM node in this demo).
 * Settlement is delegated to the VEIL demo adapter (see adapter.ts). Nothing here
 * pretends that a transfer happened on-chain when it did not.
 */
import {
  SigningKey,
  TypedDataEncoder,
  keccak256,
  recoverAddress,
  toUtf8Bytes,
  getBytes,
  Wallet,
} from 'ethers';
import { X402PaymentRequirement, VerifyPaymentResult, X402EIP3009Payload } from './types';

/** EIP-3009 initializer/joiners for WETH-style; not needed for USDC(v2). */
const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

export interface EIP3009Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string; // ERC-20 (USDC) contract
}

export interface SignExactPaymentParams {
  domain: EIP3009Domain;
  payerKey: string; // hex private key of the paying wallet
  to: string; // payTo (recipient)
  value: string; // amount in atomic units
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface SignedExactPayment {
  signature: string;
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
}

/** EIP-712 digest for EIP-3009 transferWithAuthorization (exact scheme). */
export function computeTransferAuthorizationDigest(
  domain: EIP3009Domain,
  authorization: SignedExactPayment['authorization'],
): string {
  const value: Record<string, string> = {
    from: authorization.from,
    to: authorization.to,
    value: authorization.value,
    validAfter: authorization.validAfter,
    validBefore: authorization.validBefore,
    nonce: authorization.nonce,
  };
  return TypedDataEncoder.hash(
    {
      name: domain.name,
      version: domain.version,
      chainId: domain.chainId.toString(),
      verifyingContract: domain.verifyingContract,
    },
    EIP3009_TYPES,
    value,
  );
}

/** Builds the `accepts` entry advertised by a USDC-denominated x402 resource server. */
export function buildUsdcRequirement(opts: {
  payTo: string;
  amountAtoms: string;
  resource: string;
  description: string;
  chainId: number; // e.g. 84532 (Base Sepolia)
  usdcAddress: string;
  maxTimeoutSeconds?: number;
}): X402PaymentRequirement {
  return {
    scheme: 'exact',
    network: `eip155:${opts.chainId}`,
    maxAmountRequired: opts.amountAtoms,
    resource: opts.resource,
    description: opts.description,
    payTo: opts.payTo,
    maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 60,
    asset: opts.usdcAddress,
    mimeType: 'application/json',
    extra: { name: 'USD Coin', version: '2', assetTransferMethod: 'eip3009' },
  };
}

/**
 * Client-side: signs an exact/EIP-3009 payment payload.
 * @returns the full X402EIP3009Payload object and the EIP-712 digest used.
 */
export function signExactPayment(
  params: SignExactPaymentParams,
  resourceUrl: string,
  description: string,
  requirement: X402PaymentRequirement,
): { payload: X402EIP3009Payload; digest: string } {
  const sigKey = new SigningKey(params.payerKey);
  const from = new Wallet(params.payerKey).address;
  const authorization = {
    from,
    to: params.to,
    value: params.value,
    validAfter: params.validAfter,
    validBefore: params.validBefore,
    nonce: params.nonce,
  };
  const digest = computeTransferAuthorizationDigest(params.domain, authorization);
  const signature = sigKey.sign(digest).serialized;

  const payload: X402EIP3009Payload = {
    x402Version: 2,
    resource: { url: resourceUrl, description, mimeType: 'application/json' },
    accepted: {
      scheme: requirement.scheme,
      network: requirement.network,
      amount: params.value,
      asset: requirement.asset,
      payTo: requirement.payTo,
      maxTimeoutSeconds: requirement.maxTimeoutSeconds,
      extra: requirement.extra as X402EIP3009Payload['accepted']['extra'],
    },
    payload: { signature, authorization },
  };
  return { payload, digest };
}

/**
 * Server-side: verifies an exact/EIP-3009 payment payload WITHOUT any on-chain
 * check. Uses ECRECOVER to prove the signature was produced by the `from`
 * account and that the signed amount covers the requirement.
 *
 * This is the same verification a facilitator performs against the token's
 * EIP-712 domain. It does NOT confirm the transfer was broadcast on-chain.
 */
/**
 * Nonce replay store for `exact` payments. A captured X-PAYMENT header must
 * never verify twice — EIP-3009 nonces are single-use by design.
 */
const usedNonces = new Set<string>();

/** Test hook: clear the replay store. */
export function clearUsedNonces(): void {
  usedNonces.clear();
}

/**
 * Verify an `exact`/EIP-3009 X-PAYMENT payload.
 *
 * Checks (in order):
 *   1. payTo matches the provider requirement
 *   2. from is present
 *   3. authorization time window is valid (validAfter <= now <= validBefore)
 *   4. nonce has not been used before (replay guard)
 *   5. EIP-712 signature recovers to the payer
 *   6. signed amount covers the requirement
 *
 * This is the same verification a facilitator performs against the token's
 * EIP-712 domain. It does NOT confirm the transfer was broadcast on-chain.
 */
export function verifyExactPayment(
  payload: X402EIP3009Payload,
  expectedPayTo: string,
  requiredAmountAtoms?: string,
): VerifyPaymentResult {
  const { authorization, signature } = payload.payload;
  if (authorization.to.toLowerCase() !== expectedPayTo.toLowerCase()) {
    return { ok: false, error: 'payTo mismatch' };
  }
  if (authorization.from === undefined || authorization.from.length === 0) {
    return { ok: false, error: 'missing from address' };
  }

  // Time-window validation (with 30s clock skew tolerance on validAfter).
  const nowSec = Math.floor(Date.now() / 1000);
  const validAfter = Number(authorization.validAfter);
  const validBefore = Number(authorization.validBefore);
  if (!Number.isFinite(validAfter) || !Number.isFinite(validBefore)) {
    return { ok: false, error: 'invalid authorization time window' };
  }
  if (nowSec < validAfter - 30) {
    return { ok: false, error: 'authorization not yet valid' };
  }
  if (nowSec > validBefore) {
    return { ok: false, error: 'authorization expired' };
  }

  // Replay guard: each EIP-3009 nonce may only be presented once.
  const nonceKey = `${authorization.from.toLowerCase()}:${authorization.nonce.toLowerCase()}`;
  if (usedNonces.has(nonceKey)) {
    return { ok: false, error: 'nonce already used' };
  }

  // Reconstruct the exact EIP-712 digest. To verify we need the token domain;
  // we derive it from the payload.accepted.extra (name/version) + network.
  const chainId = Number(payload.accepted.network.replace('eip155:', ''));
  const domain: EIP3009Domain = {
    name: (payload.accepted.extra?.name as string) ?? 'USD Coin',
    version: (payload.accepted.extra?.version as string) ?? '2',
    chainId,
    verifyingContract: payload.accepted.asset,
  };
  const digest = computeTransferAuthorizationDigest(domain, authorization);

  try {
    getBytes(signature); // validates hex length
  } catch {
    return { ok: false, error: 'invalid signature encoding' };
  }

  const recovered = recoverAddress(digest, signature);
  if (recovered.toLowerCase() !== authorization.from.toLowerCase()) {
    return { ok: false, error: 'signature does not recover to payer' };
  }

  if (requiredAmountAtoms !== undefined) {
    if (BigInt(authorization.value) < BigInt(requiredAmountAtoms)) {
      return { ok: false, error: 'signed amount below requirement' };
    }
  }

  // Commit the nonce only after every check passes.
  usedNonces.add(nonceKey);

  return { ok: true, payer: recovered };
}

/** Hash helper used to build deterministic EIP-712 values (e.g. nonce). */
export function keccak256Of(input: string): string {
  return keccak256(toUtf8Bytes(input));
}