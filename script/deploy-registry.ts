import 'dotenv/config';
import { execSync } from 'child_process';

/**
 * Deploy enhanced VeilRegistry to Creditcoin CC3.
 * 
 * The registry stores agent endpoints, card hashes, and metadata
 * for A2A agent discovery on-chain.
 * 
 * No constructor args needed (VeilRegistry has no constructor params).
 */

function run(cmd: string): string {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: 'pipe' }).toString();
}

function extractAddress(output: string): string {
  const m = output.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
  if (!m) throw new Error(`Could not parse deployed address from:\n${output}`);
  return m[1];
}

function main() {
  const ccRpc = process.env.CREDITCOIN_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network';
  const pk = process.env.CREDITCOIN_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error('CREDITCOIN_WALLET_PRIVATE_KEY is required');

  // Deploy VeilRegistry (no constructor args)
  const existing = process.env.VEIL_REGISTRY_ADDRESS;
  if (existing) {
    console.log(`VeilRegistry already deployed at: ${existing}`);
    console.log('Set VEIL_REGISTRY_ADDRESS=<new> to deploy a fresh one.');
    return;
  }

  const out = run(
    `forge create --broadcast --rpc-url "${ccRpc}" --private-key "${pk}" contracts/src/VeilRegistry.sol:VeilRegistry`
  );
  const addr = extractAddress(out);
  console.log(`\nVeilRegistry deployed at: ${addr}`);
  console.log(`\nAdd to .env:`);
  console.log(`VEIL_REGISTRY_ADDRESS=${addr}`);
}

main();
