import 'dotenv/config';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Wallet } from 'ethers';

/**
 * VEIL Full ZKP Deployment Script
 *
 * Deploys ALL contracts (including ZKP changes) to both Sepolia and CC3:
 *
 * CC3 (Creditcoin Testnet):
 *   1. ZKReceiptVerifier   — Groth16 on-chain verifier
 *   2. ReputationEngine    — settlement history
 *   3. MandateManager      — budget/authorization
 *   4. EscrowManager       — payment escrow
 *   5. SettlementEngine    — settlement logic (with ZK gate)
 *   6. AttestationReceiver — cross-chain verification (with ZKReceipt action)
 *   7. Wire all contracts together
 *   8. Register VeilSource on ASC
 *
 * Sepolia:
 *   9. VeilSource — source-chain event emitter (with ZKReceiptRecorded)
 */

function run(cmd: string): string {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf8' });
}

function extractAddress(output: string): string {
  const m = output.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
  if (!m) throw new Error(`Could not parse deployed address from:\n${output}`);
  return m[1];
}

function deployContract(rpc: string, pk: string, source: string, constructorArgs?: string): string {
  let out: string;
  const root = join(process.cwd(), 'contracts');
  if (constructorArgs) {
    const argsFile = join(tmpdir(), `veil-args-${Date.now()}.txt`);
    writeFileSync(argsFile, constructorArgs, 'utf8');
    out = run(`forge create --broadcast --rpc-url "${rpc}" --private-key "${pk}" --constructor-args-path "${argsFile}" --root "${root}" ${source}`);
  } else {
    out = run(`forge create --broadcast --rpc-url "${rpc}" --private-key "${pk}" --root "${root}" ${source}`);
  }
  return extractAddress(out);
}

function main() {
  const ccRpc = process.env.CREDITCOIN_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network';
  const sepoliaRpc = process.env.SOURCE_CHAIN_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
  const ccPk = process.env.CREDITCOIN_WALLET_PRIVATE_KEY;
  const sepoliaPk = process.env.SOURCE_CHAIN_WALLET_PRIVATE_KEY;

  if (!ccPk) throw new Error('CREDITCOIN_WALLET_PRIVATE_KEY is required');
  if (!sepoliaPk) throw new Error('SOURCE_CHAIN_WALLET_PRIVATE_KEY is required');

  const addresses: Record<string, string> = {};
  const stateDir = join(process.cwd(), '.veil');
  const stateFile = join(stateDir, 'deploy-state.json');

  console.log('\n=== VEIL ZKP Full Deployment ===\n');

  // --- CC3 Deployment --- //
  console.log('--- CC3 (Creditcoin Testnet) ---\n');

  // 1. ZKReceiptVerifier (new)
  console.log('[1/8] Deploying ZKReceiptVerifier...');
  addresses.zkVerifier = deployContract(ccRpc, ccPk, 'src/ZKReceiptVerifier.sol:ZKReceiptVerifier');
  console.log(`  ZKReceiptVerifier: ${addresses.zkVerifier}\n`);

  // 2. ReputationEngine
  console.log('[2/8] Deploying ReputationEngine...');
  addresses.reputation = deployContract(ccRpc, ccPk, 'src/ReputationEngine.sol:ReputationEngine');
  console.log(`  ReputationEngine: ${addresses.reputation}\n`);

  // 3. MandateManager
  console.log('[3/8] Deploying MandateManager...');
  addresses.mandates = deployContract(ccRpc, ccPk, 'src/MandateManager.sol:MandateManager');
  console.log(`  MandateManager: ${addresses.mandates}\n`);

  // 4. EscrowManager
  console.log('[4/8] Deploying EscrowManager...');
  addresses.escrows = deployContract(ccRpc, ccPk, 'src/EscrowManager.sol:EscrowManager');
  console.log(`  EscrowManager: ${addresses.escrows}\n`);

  // 5. SettlementEngine (wired to MandateManager + EscrowManager + placeholder ASC + ReputationEngine)
  console.log('[5/8] Deploying SettlementEngine (temporary ASC placeholder)...');
  const operatorAddr = new Wallet(ccPk).address;
  addresses.settlement = deployContract(
    ccRpc, ccPk,
    'src/SettlementEngine.sol:SettlementEngine',
    `${addresses.mandates} ${addresses.escrows} ${operatorAddr} ${addresses.reputation}`,
  );
  console.log(`  SettlementEngine: ${addresses.settlement}\n`);

  // 6. AttestationReceiver (wired to SettlementEngine)
  console.log('[6/8] Deploying AttestationReceiver...');
  addresses.asc = deployContract(ccRpc, ccPk, 'src/AttestationReceiver.sol:AttestationReceiver');
  console.log(`  AttestationReceiver: ${addresses.asc}\n`);

  // 7. Wire everything
  console.log('[7/8] Wiring contracts...');
  // SettlementEngine needs the real ASC address
  run(`cast send --rpc-url "${ccRpc}" --private-key "${ccPk}" "${addresses.settlement}" "setAttestationReceiver(address)" "${addresses.asc}"`);
  // SettlementEngine owner -> operator (deployer)
  run(`cast send --rpc-url "${ccRpc}" --private-key "${ccPk}" "${addresses.settlement}" "setSettlementOperator(address)" "${new Wallet(ccPk).address}"`);
  // EscrowManager -> SettlementEngine
  run(`cast send --rpc-url "${ccRpc}" --private-key "${ccPk}" "${addresses.escrows}" "setSettlementEngine(address)" "${addresses.settlement}"`);
  // MandateManager -> SettlementEngine
  run(`cast send --rpc-url "${ccRpc}" --private-key "${ccPk}" "${addresses.mandates}" "setSettlementEngine(address)" "${addresses.settlement}"`);
  // ReputationEngine -> SettlementEngine
  run(`cast send --rpc-url "${ccRpc}" --private-key "${ccPk}" "${addresses.reputation}" "setSettlementEngine(address)" "${addresses.settlement}"`);
  console.log('  All contracts wired.\n');

  // --- Sepolia Deployment --- //
  console.log('--- Sepolia (Ethereum Testnet) ---\n');

  // 8. VeilSource (ASC address is needed for future registerVeilSource)
  console.log('[8/8] Deploying VeilSource...');
  addresses.veilSource = deployContract(sepoliaRpc, sepoliaPk, 'src/VeilSource.sol:VeilSource');
  console.log(`  VeilSource: ${addresses.veilSource}\n`);

  // 9. Register VeilSource on ASC
  console.log('[9/9] Registering VeilSource on ASC...');
  run(`cast send --rpc-url "${ccRpc}" --private-key "${ccPk}" "${addresses.asc}" "registerVeilSource(address)" "${addresses.veilSource}"`);
  console.log(`  VeilSource registered on ASC.\n`);

  // Save state
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ ...addresses, deployedAt: new Date().toISOString() }, null, 2));

  console.log('\n=== Deployment Complete ===\n');
  console.log('Record these in .env and frontend/.env:\n');
  console.log(`# CC3`);
  console.log(`ZK_VERIFIER_ADDRESS=${addresses.zkVerifier}`);
  console.log(`REPUTATION_ENGINE_ADDRESS=${addresses.reputation}`);
  console.log(`MANDATE_MANAGER_ADDRESS=${addresses.mandates}`);
  console.log(`ESCROW_MANAGER_ADDRESS=${addresses.escrows}`);
  console.log(`SETTLEMENT_ENGINE_ADDRESS=${addresses.settlement}`);
  console.log(`USC_ATTESTATION_RECEIVER_ADDRESS=${addresses.asc}`);
  console.log(`# Sepolia`);
  console.log(`SOURCE_CHAIN_CONTRACT_ADDRESS=${addresses.veilSource}`);
}

main();
