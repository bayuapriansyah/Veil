import 'dotenv/config';
import { execSync } from 'child_process';

/**
 * VEIL deployment orchestrator.
 *
 * Mirrors the official loan-flow deployment procedure (verified in PHASE 0):
 *   1. Deploy the EvmV1Decoder library on Creditcoin (forge create)
 *   2. Deploy the AttestationReceiver ASC with the decoder library linked
 *      (forge create --libraries ...EvmV1Decoder:<lib_addr>)
 *   3. Deploy VeilSource on the source chain (Sepolia)
 *   4. Register VeilSource on the AttestationReceiver (cast send)
 *
 * Requires: `forge` + `cast` on PATH, a funded CC3-testnet wallet (CTC) and
 * a funded Sepolia wallet, and the RPC URLs. See .env.example.
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

function main() {
  const ccRpc = process.env.CREDITCOIN_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network';
  const srcRpc = process.env.SOURCE_CHAIN_RPC_URL;
  const pk = process.env.CREDITCOIN_WALLET_PRIVATE_KEY;
  const srcKey = process.env.SOURCE_CHAIN_KEY ?? '1';

  if (!pk) throw new Error('CREDITCOIN_WALLET_PRIVATE_KEY is required');
  if (!srcRpc) throw new Error('SOURCE_CHAIN_RPC_URL is required');

  // 1. Decoder library (skip if already deployed / provided)
  let decoderAddr = process.env.USC_DECODER_LIBRARY_ADDRESS ?? '';
  if (!decoderAddr) {
    const out = run(
      `forge create --broadcast --rpc-url "${ccRpc}" --private-key "${pk}" ` +
        `node_modules/@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol:EvmV1Decoder`,
    );
    decoderAddr = extractAddress(out);
    console.log(`EvmV1Decoder deployed at: ${decoderAddr}`);
  } else {
    console.log(`Using existing EvmV1Decoder: ${decoderAddr}`);
  }

  // 2. AttestationReceiver with linked library
  const ascOut = run(
    `forge create --broadcast --rpc-url "${ccRpc}" --private-key "${pk}" ` +
      `--libraries "@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol:EvmV1Decoder:${decoderAddr}" ` +
      `contracts/src/AttestationReceiver.sol:AttestationReceiver`,
  );
  const ascAddr = extractAddress(ascOut);
  console.log(`AttestationReceiver deployed at: ${ascAddr}`);

  // 3. VeilSource on the source chain
  const sourceOut = run(
    `forge create --broadcast --rpc-url "${srcRpc}" --private-key "${pk}" contracts/src/VeilSource.sol:VeilSource`,
  );
  const sourceAddr = extractAddress(sourceOut);
  console.log(`VeilSource deployed at: ${sourceAddr}`);

  // 4. Register VeilSource on the ASC
  run(
    `cast send --rpc-url "${ccRpc}" --private-key "${pk}" "${ascAddr}" ` +
      `"registerVeilSource(address)" "${sourceAddr}"`,
  );
  console.log(`VeilSource registered on AttestationReceiver ${ascAddr}`);

  console.log('\nCongratulations. Record these addresses in .env:');
  console.log(`SOURCE_CHAIN_CONTRACT_ADDRESS=${sourceAddr}`);
  console.log(`USC_ATTESTATION_RECEIVER_ADDRESS=${ascAddr}`);
  console.log(`USC_DECODER_LIBRARY_ADDRESS=${decoderAddr}`);
}

main();