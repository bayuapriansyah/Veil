/**
 * On-chain settlement state provider — reads escrow, mandate, attestation,
 * and reputation state directly from the deployed Creditcoin CC3 contracts.
 *
 * This replaces the in-memory `SettlementLedger` in production mode.
 * Both implement `SettlementStateProvider` so the provider server and
 * adapter work identically in demo and production.
 */
import { Contract, JsonRpcProvider } from 'ethers';

import { SettlementStateProvider, EscrowStatus } from './types';

const RECEIVER_ABI = [
  'function isPaymentVerified(uint256 orderId) external view returns (bool)',
  'function isFulfillmentVerified(uint256 orderId) external view returns (bool)',
  'function verifiedPaymentAmount(uint256 orderId) external view returns (uint256)',
  'function verifiedServiceIdOf(uint256 orderId) external view returns (bytes32)',
  'function verifiedProviderOf(uint256 orderId) external view returns (address)',
];

const ESCROW_ABI = [
  'function escrowStatus(uint256 orderId) external view returns (uint8)',
  'function escrowPayer(uint256 orderId) external view returns (address)',
  'function escrowProvider(uint256 orderId) external view returns (address)',
];

const MANDATE_ABI = [
  'function isMandateValid(uint256 mandateId, bytes32 serviceId, uint256 amount) external view returns (bool)',
  'function mandates(uint256 mandateId) external view returns (uint256 mandateId, address owner, uint256 agentId, uint256 budget, bytes32 allowedService, uint64 expiration, bool revoked, uint256 spent)',
];

const REP_ABI = [
  'function reputationOf(address provider) external view returns (uint256)',
];

export interface OnChainStateProviderConfig {
  ccRpcUrl: string;
  attestationReceiverAddress: string;
  escrowManagerAddress: string;
  mandateManagerAddress: string;
  reputationEngineAddress: string;
}

export function loadOnChainStateProviderConfig(): OnChainStateProviderConfig | null {
  const receiver = process.env.USC_ATTESTATION_RECEIVER_ADDRESS;
  const escrow = process.env.ESCROW_MANAGER_ADDRESS;
  const mandate = process.env.MANDATE_MANAGER_ADDRESS;
  const rep = process.env.REPUTATION_ENGINE_ADDRESS;
  const ccRpc = process.env.CREDITCOIN_RPC_URL;

  if (!receiver || !escrow || !mandate || !rep || !ccRpc) return null;

  return {
    ccRpcUrl: ccRpc,
    attestationReceiverAddress: receiver,
    escrowManagerAddress: escrow,
    mandateManagerAddress: mandate,
    reputationEngineAddress: rep,
  };
}

/**
 * Reads settlement state from the real Creditcoin CC3 contracts.
 * All calls are read-only (view functions), no gas needed.
 */
export class OnChainStateProvider implements SettlementStateProvider {
  private receiver: Contract;
  private escrow: Contract;
  private mandate: Contract;
  private rep: Contract;

  constructor(config: OnChainStateProviderConfig) {
    const provider = new JsonRpcProvider(config.ccRpcUrl);
    this.receiver = new Contract(config.attestationReceiverAddress, RECEIVER_ABI, provider);
    this.escrow = new Contract(config.escrowManagerAddress, ESCROW_ABI, provider);
    this.mandate = new Contract(config.mandateManagerAddress, MANDATE_ABI, provider);
    this.rep = new Contract(config.reputationEngineAddress, REP_ABI, provider);
  }

  async escrowStatus(orderId: bigint): Promise<EscrowStatus> {
    const status = (await this.escrow.escrowStatus(orderId)) as bigint;
    return status as unknown as EscrowStatus;
  }

  async isPaymentVerified(orderId: bigint): Promise<boolean> {
    return (await this.receiver.isPaymentVerified(orderId)) as boolean;
  }

  async isFulfillmentVerified(orderId: bigint): Promise<boolean> {
    return (await this.receiver.isFulfillmentVerified(orderId)) as boolean;
  }

  async verifiedServiceIdOf(orderId: bigint): Promise<string> {
    return (await this.receiver.verifiedServiceIdOf(orderId)) as string;
  }

  async activeMandateOf(
    owner: string,
    serviceId: string,
  ): Promise<{ mandateId: number; budget: bigint; spent: bigint } | undefined> {
    // On-chain mandate discovery requires knowing the mandate ID.
    // In production, the mandate ID is returned by createMandate() and stored.
    // For now, return undefined — the caller should use the mandate ID from
    // the createMandate tx receipt.
    return undefined;
  }

  async reputationOf(provider: string): Promise<number> {
    const score = (await this.rep.reputationOf(provider)) as bigint;
    return Number(score);
  }
}
