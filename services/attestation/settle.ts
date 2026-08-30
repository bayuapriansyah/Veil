/**
 * On-chain settlement for VEIL (Creditcoin CC3).
 *
 * The settlement stack lives on the SAME chain as the AttestationReceiver ASC
 * (Creditcoin), so the SettlementEngine can read the REAL verification state:
 *
 *   MandateManager  -> budget/authorization (owner = operator)
 *   EscrowManager   -> locks the payment until facts are proven
 *   ReputationEngine -> settlement success/failure history
 *   SettlementEngine -> settle(): only settles when BOTH ASC facts are verified
 *
 * `trySettleOrder` is the operator/worker-side pipeline. It NEVER fabricates a
 * settlement: every call path reverts unless the ASC already marked the order
 * payment-verified AND fulfillment-verified. Money is real CC3 CTC (native).
 *
 * Pipeline:
 *   1. createMandate(orderId, budget=verifiedAmount, allowedService, +30d)
 *   2. createEscrow(orderId, mandateId, provider)  — signed by the AGENT wallet
 *      (payer MUST equal the ASC-verified agent; enforced inside settle())
 *   3. settle(orderId) — signed by the OPERATOR; releases CTC to the provider
 *
 * Soft-fail: any missing wiring or revert is returned as { ok:false, error } —
 * the caller (worker) logs it and keeps running.
 */
import { Contract, JsonRpcApiProvider, Wallet } from 'ethers';

import { VeilConfig } from './config';

const RECEIVER_ABI = [
  'function isPaymentVerified(uint256 orderId) external view returns (bool)',
  'function isFulfillmentVerified(uint256 orderId) external view returns (bool)',
  'function verifiedPaymentAmount(uint256 orderId) external view returns (uint256)',
  'function verifiedServiceIdOf(uint256 orderId) external view returns (bytes32)',
  'function verifiedProviderOf(uint256 orderId) external view returns (address)',
];

const MANDATE_MANAGER_ABI = [
  'function createMandate(uint256 agentId, uint256 budget, bytes32 allowedService, uint64 expiration) external returns (uint256)',
];

const ESCROW_MANAGER_ABI = [
  'function createEscrow(uint256 orderId, uint256 mandateId, address provider) external payable',
  'function escrowStatus(uint256 orderId) external view returns (uint8)',
];

const SETTLEMENT_ENGINE_ABI = ['function settle(uint256 orderId) external'];

export interface SettlementResult {
  ok: boolean;
  /** true = nothing left to do (settled, or escrow already locked). */
  done: boolean;
  mandateId?: string;
  escrowTxHash?: string;
  settlementTxHash?: string;
  error?: string;
}

/** The on-chain settlement stack is available only when all 4 addresses are set. */
export function settlementEnabled(): boolean {
  return !!(
    process.env.SETTLEMENT_ENGINE_ADDRESS &&
    process.env.ESCROW_MANAGER_ADDRESS &&
    process.env.MANDATE_MANAGER_ADDRESS &&
    process.env.REPUTATION_ENGINE_ADDRESS
  );
}

/**
 * Attempt on-chain settlement for an order once BOTH ASC facts are verified.
 * Returns { done:true } when there is nothing left to retry.
 */
export async function trySettleOrder(config: VeilConfig, ccProvider: JsonRpcApiProvider, orderId: bigint | string): Promise<SettlementResult> {
  const id = BigInt(orderId);
  if (!settlementEnabled()) {
    return { ok: false, done: false, error: 'settlement stack not deployed (set SETTLEMENT_ENGINE_ADDRESS, ESCROW_MANAGER_ADDRESS, MANDATE_MANAGER_ADDRESS, REPUTATION_ENGINE_ADDRESS)' };
  }
  const agentKey = process.env.SOURCE_CHAIN_WALLET_PRIVATE_KEY;
  if (!agentKey) {
    return { ok: false, done: false, error: 'SOURCE_CHAIN_WALLET_PRIVATE_KEY required to lock escrow (agent wallet must hold CTC)' };
  }

  try {
    const receiver = new Contract(config.attestationReceiverAddress, RECEIVER_ABI, ccProvider);

    // 0. Only settle orders the ASC has ALREADY verified on both facts.
    const [payVerified, fulVerified] = await Promise.all([
      receiver.isPaymentVerified(id),
      receiver.isFulfillmentVerified(id),
    ]);
    if (!payVerified || !fulVerified) {
      return { ok: false, done: false, error: `not both ASC-verified yet (payment=${payVerified} fulfillment=${fulVerified})` };
    }

    const escrowManager = new Contract(process.env.ESCROW_MANAGER_ADDRESS!, ESCROW_MANAGER_ABI, ccProvider);
    const status = (await escrowManager.escrowStatus(id)) as bigint;

    const operatorWallet = new Wallet(config.walletPrivateKey, ccProvider);
    const engine = new Contract(process.env.SETTLEMENT_ENGINE_ADDRESS!, SETTLEMENT_ENGINE_ABI, operatorWallet);

    if (status === 2n || status === 3n) {
      return { ok: false, done: true, error: `escrow already in state ${status} (released/refunded)` };
    }

    if (status === 1n) {
      const settleTx = await engine.settle(id);
      const settleReceipt = await settleTx.wait();
      return {
        ok: true,
        done: true,
        escrowTxHash: undefined,
        settlementTxHash: settleReceipt.hash,
      };
    }

    const amount = (await receiver.verifiedPaymentAmount(id)) as bigint;
    const serviceId = (await receiver.verifiedServiceIdOf(id)) as string;
    const provider = (await receiver.verifiedProviderOf(id)) as string;
    const agentWallet = new Wallet(agentKey, ccProvider);

    // 1. Mandate (owner = operator) covering exactly the verified amount.
    const mandateManager = new Contract(process.env.MANDATE_MANAGER_ADDRESS!, MANDATE_MANAGER_ABI, operatorWallet);
    const expiration = BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400);
    // Predict the id BEFORE sending (nextMandateId advances by one per call).
    const mandateId = (await mandateManager.createMandate.staticCall(1n, amount, serviceId, expiration)) as bigint;
    const mandateTx = await mandateManager.createMandate(1n, amount, serviceId, expiration);
    await mandateTx.wait();

    // 2. Lock escrow signed by the AGENT wallet — payer must be the ASC-verified agent.
    const escrowSigned = new Contract(process.env.ESCROW_MANAGER_ADDRESS!, ESCROW_MANAGER_ABI, agentWallet);
    const escrowTx = await escrowSigned.createEscrow(id, mandateId, provider, { value: amount });
    const escrowReceipt = await escrowTx.wait();

    // 3. Operator settles: releases CTC to the provider.
    const settleTx = await engine.settle(id);
    const settleReceipt = await settleTx.wait();

    return {
      ok: true,
      done: true,
      mandateId: mandateId.toString(),
      escrowTxHash: escrowReceipt.hash,
      settlementTxHash: settleReceipt.hash,
    };
  } catch (e) {
    return { ok: false, done: false, error: e instanceof Error ? e.message : String(e) };
  }
}