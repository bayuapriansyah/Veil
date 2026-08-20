/**
 * VEIL run mode — `demo` vs `production`.
 *
 * The SAME code runs in both modes; only the wallet provisioning and
 * on-chain recording differ:
 *   - `demo`:       agent wallets are generated at startup (Wallet.createRandom)
 *                   — no env keys, no funding, no RPC needed. On-chain
 *                   recording is disabled, so the vault honestly labels
 *                   attestation as `mirror`. Ideal for local testing / judges.
 *   - `production`: agent identity comes from real funded env keys and every
 *                   purchase records a live source-chain event that the
 *                   Attestcoin worker proves on Creditcoin.
 *
 * Selection: explicit `VEIL_MODE=demo|production`, else auto-detect (live
 * source-chain keys + contract address present => production).
 */
import 'dotenv/config';

export type VeilMode = 'demo' | 'production';

export function resolveVeilMode(): VeilMode {
  const m = process.env.VEIL_MODE?.toLowerCase();
  if (m === 'demo' || m === 'production') return m;
  // Auto-detect: a wired production setup has both the source-chain signing key
  // and the deployed VeilSource address. Without them we cannot record on-chain.
  if (process.env.SOURCE_CHAIN_WALLET_PRIVATE_KEY && process.env.SOURCE_CHAIN_CONTRACT_ADDRESS) {
    return 'production';
  }
  return 'demo';
}

export function isDemoMode(): boolean {
  return resolveVeilMode() === 'demo';
}

export function isProductionMode(): boolean {
  return resolveVeilMode() === 'production';
}