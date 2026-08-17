import { JsonRpcApiProvider } from 'ethers';
import { chainInfo, proofProvider } from '@gluwa/usc-sdk';

/**
 * Proof generation helpers for the VEIL Attestcoin integration.
 *
 * Uses the verified @gluwa/usc-sdk (v0.18.0) ProofBuilder service:
 *   - ProofBuilder(chainKey, proofBuilderUrl) hits:
 *       GET /api/v1/proof-by-tx/{chainKey}/{txHash}
 *     after GET /api/v1/attested-height/{chainKey} confirms the block is attested.
 *
 * @see docs/attestcoin.md for verified Proof Builder API endpoints.
 */
export interface ProofGenerationResult {
  success: boolean;
  data?: proofProvider.ContinuityResponse;
  error?: string;
}

/**
 * Generates a proof for a transaction on the source chain after waiting for
 * its block to be attested on Creditcoin.
 *
 * @param txHash Source-chain transaction hash to prove.
 * @param chainKey Creditcoin-internal source chain key (Sepolia = 1 on CC3 Testnet).
 * @param proofBuilderUrl Proof builder service root URL.
 * @param creditcoinRpc Provider connected to Creditcoin (used for chain info checks).
 * @param sourceChainRpc Provider connected to the source chain.
 */
export async function generateProofFor(
  txHash: string,
  chainKey: number,
  proofBuilderUrl: string,
  creditcoinRpc: JsonRpcApiProvider,
  sourceChainRpc: JsonRpcApiProvider,
): Promise<ProofGenerationResult> {
  const transaction = await sourceChainRpc.getTransaction(txHash);
  if (!transaction) {
    return { success: false, error: `Transaction ${txHash} does not exist on source chain` };
  }
  const blockNumber = transaction.blockNumber;
  if (!blockNumber) {
    return { success: false, error: `Transaction ${txHash} is not yet mined on source chain` };
  }

  const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, proofBuilderUrl);
  const info = new chainInfo.PrecompileChainInfoProvider(creditcoinRpc);

  const latestAttested = await info.getLatestAttestedHeightAndHash(chainKey);
  if (blockNumber > latestAttested.height) {
    return {
      success: false,
      error: `Block ${blockNumber} not yet attested (latest attested: ${latestAttested.height})`,
    };
  }

  // Give the proof builder a moment to ingest the attestation into its cache.
  await proofBuilder.waitUntilHeightAttested(chainKey, blockNumber, 15_000, 300_000);

  const result = await proofBuilder.getProof(txHash);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, data: result.data };
}

/**
 * Generates a batch proof for multiple transactions sharing a continuity proof.
 * @returns The batch proof result, verified on-chain by verifyBatch.
 */
export async function generateBatchProofFor(
  txHashes: string[],
  chainKey: number,
  proofBuilderUrl: string,
): Promise<proofProvider.BatchProofResult> {
  const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, proofBuilderUrl);
  return proofBuilder.getBatchProof(txHashes);
}