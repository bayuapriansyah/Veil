/**
 * Crypto for the VEIL audit vault — authenticated encryption only.
 *
 * - AES-256-GCM (authenticated: tampered ciphertext fails with a BadTag error).
 * - A per-transaction data key is derived from the master vault key via HKDF
 *   (info = txId), so one leaked per-tx key does not expose the whole vault.
 * - The master key is NEVER hardcoded. It comes (in order):
 *      1. env `VEIL_VAULT_KEY`     (64 hex chars -> 32 bytes)
 *      2. env `VEIL_VAULT_KEY_FILE` (path to a file whose first line is the hex)
 *      3. an ephemeral random key  (demo/tests only — lost on restart)
 *
 * NOTE: this protects VEIL data at rest / in the audit layer. It does NOT make
 * Attestcoin private — attestation verifies cross-chain facts; VEIL controls
 * disclosure.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  hkdfSync,
  timingSafeEqual,
} from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { SealedBox } from './types';

export const AES_TAG_LENGTH = 16; // GCM auth tag bytes
export const AES_IV_LENGTH = 12;

export function generateVaultKey(): Buffer {
  return randomBytes(32);
}

/**
 * Load the vault master key. Throws only if a configured source is broken
 * (never silently falls back to a hardcoded secret; an ephemeral key is the
 * last, clearly-labeled fallback for demo/deterministic runs).
 */
export function loadVaultKey(opts: { env?: NodeJS.ProcessEnv } = {}): { key: Buffer; source: 'env' | 'file' | 'ephemeral' } {
  const env = opts.env ?? process.env;
  const fromEnv = env.VEIL_VAULT_KEY?.trim();
  if (fromEnv && /^[0-9a-fA-F]{64}$/.test(fromEnv)) {
    return { key: Buffer.from(fromEnv, 'hex'), source: 'env' };
  }
  const keyFile = env.VEIL_VAULT_KEY_FILE?.trim();
  if (keyFile && existsSync(keyFile)) {
    const line = readFileSync(keyFile, 'utf8').split(/\r?\n/)[0]?.trim() ?? '';
    if (/^[0-9a-fA-F]{64}$/.test(line)) {
      return { key: Buffer.from(line, 'hex'), source: 'file' };
    }
  }
  if (fromEnv && fromEnv.length > 0) {
    throw new Error('VEIL_VAULT_KEY present but invalid (expected 64 hex chars)');
  }
  return { key: generateVaultKey(), source: 'ephemeral' };
}

/** Per-context data key: HKDF(master, info). info is e.g. the txId. */
export function deriveKey(masterKey: Buffer, info: string): Buffer {
  const derived = hkdfSync('sha256', masterKey, Buffer.alloc(32), Buffer.from(info, 'utf8'), 32);
  return Buffer.from(derived);
}

/** AES-256-GCM seal. Returns base64 iv/tag/ct. Throws on plaintext failure. */
export function seal(masterKey: Buffer, info: string, plaintext: string): SealedBox {
  const key = deriveKey(masterKey, info);
  const iv = randomBytes(AES_IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: 'AES-256-GCM',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ciphertext.toString('base64'),
  };
}

/**
 * AES-256-GCM open. Authenticated: a tampered box throws (auth tag mismatch),
 * so a corrupted vault record can never be silently disclosed.
 */
export function openSealedBox(masterKey: Buffer, info: string, box: SealedBox): string {
  if (box.alg !== 'AES-256-GCM') throw new Error('UnsupportedSeal: expected AES-256-GCM');
  const key = deriveKey(masterKey, info);
  const iv = Buffer.from(box.iv, 'base64');
  const tag = Buffer.from(box.tag, 'base64');
  const ct = Buffer.from(box.ct, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]); // throws BadTag on tamper
  return plain.toString('utf8');
}

/** Constant-time guarded equality (used to compare a nonce against history). */
export function boxesEqual(a: SealedBox | undefined, b: SealedBox): boolean {
  if (!a) return false;
  try {
    return timingSafeEqual(Buffer.from(a.iv, 'base64'), Buffer.from(b.iv, 'base64')) &&
      timingSafeEqual(Buffer.from(a.tag, 'base64'), Buffer.from(b.tag, 'base64')) &&
      timingSafeEqual(Buffer.from(a.ct, 'base64'), Buffer.from(b.ct, 'base64'));
  } catch {
    return false;
  }
}