/**
 * Auditor identity — EIP-712 signed `AuditAccess` requests, ECRECOVER verified,
 * so endpoints that disclose private data are reached only by the address that
 * actually signed the request (a header address alone is never trusted).
 *
 * Every disclosure binds (resource path + txId + unique nonce + expiry), which
 * stops replays of a signed request against a different transaction, and
 * bounds its lifetime.
 */
import { SigningKey, TypedDataEncoder, computeAddress, recoverAddress } from 'ethers';
import { randomBytes } from 'node:crypto';
import { AuditAccessRequest } from './types';

export const AUDIT_DOMAIN = {
  name: 'VEIL Audit Registers',
  version: '1',
  chainId: 11155111, // Ethereum Sepolia (VEIL source chain)
  verifyingContract: '0x0000000000000000000000000000000000000000' as string,
};

const AUDIT_ACCESS_TYPES = {
  AuditAccess: [
    { name: 'resource', type: 'string' },
    { name: 'txId', type: 'string' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
  ],
};

export interface SignAuditAccessOpts {
  privateKey: string;
  resource: string;
  txId: string;
  nonce?: string;
  /** Unix seconds; default now + 5 minutes. */
  expiresAt?: number;
}

export function signAuditAccess(opts: SignAuditAccessOpts): AuditAccessRequest {
  const key = new SigningKey(opts.privateKey);
  const auditor = computeAddress(key.publicKey);
  const nonce = opts.nonce ?? '0x' + randomBytes(16).toString('hex');
  const expiresAt = opts.expiresAt ?? Math.floor(Date.now() / 1000) + 300;
  const digest = TypedDataEncoder.hash(AUDIT_DOMAIN, AUDIT_ACCESS_TYPES, {
    resource: opts.resource,
    txId: opts.txId,
    nonce,
    expiresAt,
  });
  const signature = key.sign(digest).serialized;
  return { auditor, resource: opts.resource, txId: opts.txId, nonce, expiresAt, signature };
}

export interface VerifyAuditAccessOpts {
  expectedResource: string;
  expectedTxId: string;
  now?: number;
  /** Authorizer predicate: true only if the recovered signer may see the data. */
  isAuthorized: (auditor: string) => Promise<boolean>;
}

export interface VerifyAuditResult {
  ok: boolean;
  auditor?: string;
  error?: string;
}

/**
 * Verify a signed AuditAccess request:
 *   1. signature must ECRECOVER to the claimed auditor
 *   2. must be requested for exactly this resource + txId
 *   3. must not be expired
 *   4. the recovered signer must be authorized (vault decides)
 */
export async function verifyAuditAccess(req: AuditAccessRequest, opts: VerifyAuditAccessOpts): Promise<VerifyAuditResult> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (req.resource !== opts.expectedResource) {
    return { ok: false, error: 'resource mismatch' };
  }
  if (req.txId !== opts.expectedTxId) {
    return { ok: false, error: 'txId mismatch' };
  }
  if (req.expiresAt < now) {
    return { ok: false, error: 'AuditAccess expired' };
  }
  let recovered: string;
  try {
    const digest = TypedDataEncoder.hash(AUDIT_DOMAIN, AUDIT_ACCESS_TYPES, {
      resource: req.resource,
      txId: req.txId,
      nonce: req.nonce,
      expiresAt: req.expiresAt,
    });
    recovered = recoverAddress(digest, req.signature);
  } catch (e: any) {
    return { ok: false, error: `invalid signature: ${e?.message ?? e}` };
  }
  if (recovered.toLowerCase() !== req.auditor.toLowerCase()) {
    return { ok: false, error: 'signature does not recover to claimed auditor' };
  }
  if (!(await opts.isAuthorized(recovered))) {
    return { ok: false, error: 'authorization revoked or never granted' };
  }
  return { ok: true, auditor: recovered };
}