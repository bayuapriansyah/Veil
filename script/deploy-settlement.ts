import 'dotenv/config';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Wallet } from 'ethers';

/**
 * VEIL settlement-stack deployment (Creditcoin CC3).
 *
 * The settlement contracts MUST live on the same chain as the AttestationReceiver
 * ASC (Creditcoin) because SettlementEngine reads the REAL ASC verification state:
 *
 *   1. MandateManager    (budget/authorization, owner = operator)
 *   2. EscrowManager     (locks the payment until facts are proven)
 *   3. ReputationEngine  (settlement success/failure history)
 *   4. SettlementEngine  (only settles when BOTH ASC facts are verified)
 *
 * Then wires the engines and (optionally) funds the agent wallet with CC3 CTC so
 * it can lock escrow. Requires `forge` + `cast` on PATH, a funded CC3 wallet
 * (CTC) and USC_ATTESTATION_RECEIVER_ADDRESS (the already-deployed ASC).
 *
 * This script DOES NOT fabricate deployments: it executes the real forge/cast
 * CLI against real testnet infrastructure.
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

function deployContract(rpc: string, pk: string, source: string, constructorArgs?: string): string {
  let out: string;
  if (constructorArgs) {
    // forge's --constructor-args is variadic and swallows the trailing contract
    // path on some platforms — pass the args through a file instead.
    const argsFile = join(tmpdir(), `veil-settle-args-${Date.now()}.txt`);
    writeFileSync(argsFile, constructorArgs, 'utf8');
    out = run(`forge create --broadcast --rpc-url "${rpc}" --private-key "${pk}" --constructor-args-path "${argsFile}" ${source}`);
  } else {
    out = run(`forge create --broadcast --rpc-url "${rpc}" --private-key "${pk}" ${source}`);
  }
  const addr = extractAddress(out);
  console.log(`deployed ${source} at: ${addr}`);
  return addr;
}

function main() {
  const ccRpc = process.env.CREDITCOIN_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network';
  const pk = process.env.CREDITCOIN_WALLET_PRIVATE_KEY;
  const receiver = process.env.USC_ATTESTATION_RECEIVER_ADDRESS;
  if (!pk) throw new Error('CREDITCOIN_WALLET_PRIVATE_KEY is required');
  if (!receiver) throw new Error('USC_ATTESTATION_RECEIVER_ADDRESS is required (deploy the ASC first)');

  // 1-3. Mandate / Escrow / Reputation (skip if already deployed / provided)
  const mandates = process.env.MANDATE_MANAGER_ADDRESS ?? deployContract(ccRpc, pk, 'contracts/src/MandateManager.sol:MandateManager');
  const escrow = process.env.ESCROW_MANAGER_ADDRESS ?? deployContract(ccRpc, pk, 'contracts/src/EscrowManager.sol:EscrowManager');
  const reputation = process.env.REPUTATION_ENGINE_ADDRESS ?? deployContract(ccRpc, pk, 'contracts/src/ReputationEngine.sol:ReputationEngine');

  // 4. SettlementEngine with the full wiring.
  const engine = process.env.SETTLEMENT_ENGINE_ADDRESS ?? deployContract(
    ccRpc,
    pk,
    'contracts/src/SettlementEngine.sol:SettlementEngine',
    `${mandates} ${escrow} ${receiver} ${reputation}`,
  );

  // 5. Wire the engines back to the SettlementEngine.
  run(`cast send --rpc-url "${ccRpc}" --private-key "${pk}" "${escrow}" "setSettlementEngine(address)" "${engine}"`);
  run(`cast send --rpc-url "${ccRpc}" --private-key "${pk}" "${mandates}" "setSettlementEngine(address)" "${engine}"`);
  run(`cast send --rpc-url "${ccRpc}" --private-key "${pk}" "${reputation}" "setSettlementEngine(address)" "${engine}"`);
  console.log(`wired EscrowManager + MandateManager + ReputationEngine -> SettlementEngine ${engine}`);

  // 6. Optionally fund the agent wallet with CC3 CTC so it can lock escrow.
  //    FUND_AGENT_CTC is an integer amount in wei (e.g. 1000000000000000000 = 1 CTC).
  if (process.env.FUND_AGENT_CTC && process.env.SOURCE_CHAIN_WALLET_PRIVATE_KEY) {
    const agent = new Wallet(process.env.SOURCE_CHAIN_WALLET_PRIVATE_KEY).address;
    run(`cast send --rpc-url "${ccRpc}" --private-key "${pk}" --value "${process.env.FUND_AGENT_CTC}" "${agent}"`);
    console.log(`funded agent wallet ${agent} with ${process.env.FUND_AGENT_CTC} wei CTC`);
  }

  console.log('\nRecord these addresses in .env:');
  console.log(`MANDATE_MANAGER_ADDRESS=${mandates}`);
  console.log(`ESCROW_MANAGER_ADDRESS=${escrow}`);
  console.log(`REPUTATION_ENGINE_ADDRESS=${reputation}`);
  console.log(`SETTLEMENT_ENGINE_ADDRESS=${engine}`);
}

main();