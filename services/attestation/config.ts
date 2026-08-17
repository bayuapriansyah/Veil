import 'dotenv/config';

import { JsonRpcProvider } from 'ethers';

/**
 * Central configuration for the VEIL Attestcoin integration.
 *
 * All values are sourced from the verified Phase 0 findings (see docs/attestcoin.md):
 * - Creditcoin CC3 Testnet RPC:  https://rpc.cc3-testnet.creditcoin.network (chainId 102031)
 * - Proof Builder API:           https://prover.cc3-testnet.creditcoin.network (verified live)
 * - Sepolia chainKey on CC3:     1
 */
export interface VeilConfig {
  sourceChainKey: number;
  sourceChainRpcUrl: string;
  sourceChainContractAddress: string;
  creditcoinRpcUrl: string;
  attestationReceiverAddress: string;
  settlementEngineAddress?: string;
  walletPrivateKey: string;
  proofBuilderUrl: string;
}

export function loadConfig(): VeilConfig {
  const required = [
    'SOURCE_CHAIN_RPC_URL',
    'SOURCE_CHAIN_CONTRACT_ADDRESS',
    'CREDITCOIN_RPC_URL',
    'USC_ATTESTATION_RECEIVER_ADDRESS',
    'CREDITCOIN_WALLET_PRIVATE_KEY',
  ] as const;

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }

  return {
    sourceChainKey: Number(process.env.SOURCE_CHAIN_KEY ?? 1),
    sourceChainRpcUrl: process.env.SOURCE_CHAIN_RPC_URL!,
    sourceChainContractAddress: process.env.SOURCE_CHAIN_CONTRACT_ADDRESS!,
    creditcoinRpcUrl: process.env.CREDITCOIN_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network',
    attestationReceiverAddress: process.env.USC_ATTESTATION_RECEIVER_ADDRESS!,
    settlementEngineAddress: process.env.SETTLEMENT_ENGINE_ADDRESS,
    walletPrivateKey: process.env.CREDITCOIN_WALLET_PRIVATE_KEY!,
    proofBuilderUrl:
      process.env.PROOF_BUILDER_URL ?? 'https://prover.cc3-testnet.creditcoin.network',
  };
}

export function isSolvableConfig(c: VeilConfig): boolean {
  return (
    !!c.sourceChainRpcUrl &&
    !!c.sourceChainContractAddress &&
    !!c.attestationReceiverAddress &&
    !!c.walletPrivateKey
  );
}

export function sourceProvider(c: VeilConfig): JsonRpcProvider {
  return new JsonRpcProvider(c.sourceChainRpcUrl);
}

export function creditcoinProvider(c: VeilConfig): JsonRpcProvider {
  return new JsonRpcProvider(c.creditcoinRpcUrl);
}