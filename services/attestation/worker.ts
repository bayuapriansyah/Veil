import { Contract, ethers, JsonRpcApiProvider } from 'ethers';
import { loadConfig, VeilConfig, sourceProvider, creditcoinProvider } from './config';
import { generateProofFor, ProofGenerationResult } from './generateProof';

/**
 * VEIL Attestcoin worker.
 *
 * Watches the source chain (Sepolia) for VEIL events on VeilSource and, when
 * found, waits for the containing block to be attested on Creditcoin, generates
 * a proof via the Proof Builder service (@gluwa/usc-sdk), and submits it to the
 * AttestationReceiver ASC on Creditcoin via its execute() entry point.
 *
 * Actions:
 *   - AgentPayment event      -> action 0 (Payment)
 *   - FulfillmentReceipt event -> action 1 (Fulfillment)
 *
 * Requires a funded wallet (CTC) and Sepolia RPC access. See .env.example.
 */

// Human-readable ABI fragment for the AttestationReceiver.execute signature.
const ATTESTATION_RECEIVER_EXECUTE_ABI = [
  'function execute(uint8 action, uint64 chainKey, uint64 blockHeight, bytes calldata encodedTransaction, bytes32 merkleRoot, tuple(bytes32 hash, bool isLeft)[] calldata siblings, bytes32 lowerEndpointDigest, bytes32[] calldata continuityRoots) external returns (bool)',
  'event PaymentVerified(uint256 indexed orderId, address indexed agent, address indexed provider, uint256 amount, bytes32 serviceId, bytes32 queryId)',
  'event FulfillmentVerified(uint256 indexed orderId, address indexed provider, bytes32 resultHash, bytes32 queryId)',
];

const VEIL_SOURCE_ABI = [
  'event AgentPayment(uint256 indexed orderId, address indexed agent, address indexed provider, uint256 amount, bytes32 serviceId, bytes32 transactionRef)',
  'event FulfillmentReceipt(uint256 indexed orderId, address indexed provider, bytes32 resultHash, bytes32 serviceId, bytes32 transactionRef)',
];

let isShuttingDown = false;
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  isShuttingDown = true;
});
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  isShuttingDown = true;
});

const POLL_INTERVAL_MS = 10_000;
const MAX_PROCESSED_TXS = 1000;

function estimateGasForExecute(
  provider: JsonRpcApiProvider,
  contract: Contract,
  fragments: { action: number; chainKey: number; height: number; encodedTransaction: string; merkleRoot: string; siblings: unknown[]; lowerEndpointDigest: string; continuityRoots: string[] },
  from: string,
): Promise<bigint> {
  const iface = contract.interface;
  const func = iface.getFunction('execute');
  if (!func) return Promise.reject(new Error('execute fragment missing'));
  const data = iface.encodeFunctionData(func, [
    fragments.action,
    fragments.chainKey,
    fragments.height,
    fragments.encodedTransaction,
    fragments.merkleRoot,
    fragments.siblings,
    fragments.lowerEndpointDigest,
    fragments.continuityRoots,
  ]);
  // Deterministic fallback used when gas estimation fails against the precompile (pallet-evm).
  const fallback = 21000n + BigInt((fragments.continuityRoots?.length || 1) * 5000) + 20000n;
  return provider.estimateGas({ to: contract.getAddress(), data, from }).catch(() => fallback);
}

async function submitProof(
  config: VeilConfig,
  creditcoinProvider_: JsonRpcApiProvider,
  receiverContract: Contract,
  proofResult: ProofGenerationResult,
  action: number,
): Promise<string> {
  if (!proofResult.success || !proofResult.data) {
    throw new Error(`Proof generation failed: ${proofResult.error}`);
  }
  const p = proofResult.data;
  const gasLimit = await estimateGasForExecute(creditcoinProvider_, receiverContract, {
    action,
    chainKey: p.chainKey,
    height: p.headerNumber,
    encodedTransaction: p.txBytes,
    merkleRoot: p.merkleProof.root,
    siblings: p.merkleProof.siblings,
    lowerEndpointDigest: p.continuityProof.lowerEndpointDigest,
    continuityRoots: p.continuityProof.roots,
  }, (creditcoinProvider_ as any).getSigner?.().address || '');

  console.log(`Submitting proof action=${action} for tx ${p.txHash}`);
  const tx = await receiverContract.execute(
    action,
    p.chainKey,
    p.headerNumber,
    p.txBytes,
    p.merkleProof.root,
    p.merkleProof.siblings,
    p.continuityProof.lowerEndpointDigest,
    p.continuityProof.roots,
    { gasLimit },
  );
  const receipt = await tx.wait();
  console.log(`Proof submitted and mined: ${receipt.hash}`);
  return receipt.hash;
}

async function main() {
  const config = loadConfig();
  const srcProvider = sourceProvider(config);
  const ccProvider = creditcoinProvider(config);

  const wallet = new ethers.Wallet(config.walletPrivateKey, ccProvider);
  const receiverContract = new Contract(config.attestationReceiverAddress, ATTESTATION_RECEIVER_EXECUTE_ABI, wallet);
  const veilSource = new Contract(config.sourceChainContractAddress, VEIL_SOURCE_ABI, srcProvider);

  let fromBlock = await srcProvider.getBlockNumber();
  const processedTxs = new Set<string>();

  console.log('Attestcoin worker started.');
  console.log(`sourceChainKey=${config.sourceChainKey}`);
  console.log(`VeilSource=${config.sourceChainContractAddress}`);
  console.log(`AttestationReceiver=${config.attestationReceiverAddress}`);
  console.log(`Polling source chain from block ${fromBlock}`);

  while (!isShuttingDown) {
    const latest = await srcProvider.getBlockNumber();
    if (latest < fromBlock) {
      fromBlock = latest;
    }

    const [payments, fulfillments] = await Promise.all([
      veilSource.queryFilter('AgentPayment', fromBlock, latest),
      veilSource.queryFilter('FulfillmentReceipt', fromBlock, latest),
    ]);

    for (const ev of payments) {
      const txHash = ev.transactionHash;
      if (processedTxs.has(txHash)) continue;
      processedTxs.add(txHash);
      if (!('args' in ev)) continue;
      // args: orderId, agent, provider, amount, serviceId, transactionRef
      console.log(`AgentPayment detected: order=${ev.args[0]} tx=${txHash}`);
      try {
        const proof = await generateProofFor(txHash, config.sourceChainKey, config.proofBuilderUrl, ccProvider, srcProvider);
        if (proof.success) {
          const hash = await submitProof(config, ccProvider, receiverContract, proof, 0);
          console.log(`Payment action verified on Creditcoin: ${hash}`);
        } else {
          console.error(`AgentPayment proof failed: ${proof.error}`);
        }
      } catch (e: any) {
        console.error(`AgentPayment processing error: ${e?.message ?? e}`);
      }
    }

    for (const ev of fulfillments) {
      const txHash = ev.transactionHash;
      if (processedTxs.has(txHash)) continue;
      processedTxs.add(txHash);
      if (!('args' in ev)) continue;
      // args: orderId, provider, resultHash, serviceId, transactionRef
      console.log(`FulfillmentReceipt detected: order=${ev.args[0]} tx=${txHash}`);
      try {
        const proof = await generateProofFor(txHash, config.sourceChainKey, config.proofBuilderUrl, ccProvider, srcProvider);
        if (proof.success) {
          const hash = await submitProof(config, ccProvider, receiverContract, proof, 1);
          console.log(`Fulfillment action verified on Creditcoin: ${hash}`);
        } else {
          console.error(`FulfillmentReceipt proof failed: ${proof.error}`);
        }
      } catch (e: any) {
        console.error(`FulfillmentReceipt processing error: ${e?.message ?? e}`);
      }
    }

    fromBlock = latest + 1;

    if (processedTxs.size > MAX_PROCESSED_TXS) {
      processedTxs.clear();
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  srcProvider.destroy();
  ccProvider.destroy();
  console.log('Worker stopped.');
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}