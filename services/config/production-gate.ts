/**
 * Production startup validator — ensures all required env vars are present
 * when running in production mode. Fails fast with descriptive messages.
 */
import { isProductionMode } from './mode';

interface RequiredVar {
  name: string;
  description: string;
}

const PRODUCTION_VARS: RequiredVar[] = [
  { name: 'SOURCE_CHAIN_WALLET_PRIVATE_KEY', description: 'Agent wallet private key for Sepolia' },
  { name: 'SOURCE_CHAIN_PROVIDER_PRIVATE_KEY', description: 'Provider wallet private key for Sepolia' },
  { name: 'SOURCE_CHAIN_CONTRACT_ADDRESS', description: 'VeilSource contract on Sepolia' },
  { name: 'CREDITCOIN_RPC_URL', description: 'Creditcoin CC3 RPC endpoint' },
  { name: 'USC_ATTESTATION_RECEIVER_ADDRESS', description: 'AttestationReceiver on CC3' },
  { name: 'SETTLEMENT_ENGINE_ADDRESS', description: 'SettlementEngine on CC3' },
  { name: 'ESCROW_MANAGER_ADDRESS', description: 'EscrowManager on CC3' },
  { name: 'MANDATE_MANAGER_ADDRESS', description: 'MandateManager on CC3' },
  { name: 'REPUTATION_ENGINE_ADDRESS', description: 'ReputationEngine on CC3' },
  { name: 'CREDITCOIN_WALLET_PRIVATE_KEY', description: 'Worker wallet for proof submission on CC3' },
];

interface ValidationResult {
  ok: boolean;
  missing: RequiredVar[];
}

export function validateProductionEnv(): ValidationResult {
  if (!isProductionMode()) {
    return { ok: true, missing: [] };
  }

  const missing = PRODUCTION_VARS.filter((v) => !process.env[v.name]);
  return { ok: missing.length === 0, missing };
}

/**
 * Call at startup in production mode. Throws with a clear message listing
 * all missing env vars if any are absent.
 */
export function requireProductionEnv(): void {
  if (!isProductionMode()) return;

  const result = validateProductionEnv();
  if (!result.ok) {
    const lines = result.missing.map((v) => `  - ${v.name}: ${v.description}`);
    throw new Error(
      `Production mode requires these env vars:\n${lines.join('\n')}\n\nSet them in .env or the environment before starting.`,
    );
  }
}

/**
 * Returns a summary of production readiness for logging.
 */
export function productionReadinessSummary(): Record<string, unknown> {
  const result = validateProductionEnv();
  return {
    mode: isProductionMode() ? 'production' : 'demo',
    productionReady: result.ok,
    missingVars: result.missing.map((v) => v.name),
  };
}
