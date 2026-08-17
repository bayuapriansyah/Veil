/**
 * VEIL demo settlement ledger.
 *
 * This is an IN-MEMORY MIRROR of the verified Creditcoin contracts
 * (`EscrowManager.sol`, `SettlementEngine.sol`, `MandateManager.sol`) used so
 * the demo can run without a live chain. It reproduces their exact state
 * machine and access rules, which is why it is safe to write tests against it:
 *
 *   escrowStatus:  None -> Locked -> Released | Refunded
 *   release():     only when Locked (mirrors SettlementEngine.settle result)
 *   refund():      only when Locked (payer or settlement engine)
 *   mandate:       budget/expiry/revocation checks (mirrors MandateManager)
 *   attestation:   payment/fulfillment flags (mirrors AttestationReceiver state)
 *
 * It is NOT the deployed contract. When the live chain is available, the
 * provider/service must call the real contracts instead.
 */
export enum EscrowStatus {
  None = 0,
  Locked = 1,
  Released = 2,
  Refunded = 3,
}

export interface Escrow {
  orderId: bigint;
  payer: string;
  provider: string;
  mandateId: number;
  amount: bigint;
  status: EscrowStatus;
}

export interface Mandate {
  mandateId: number;
  owner: string;
  agentId: number;
  budget: bigint;
  serviceId: string; // bytes32 as hex
  expiresAt: number;
  revoked: boolean;
  spent: bigint;
}

/**
 * Provider reputation (star rating 1-5; 0 = unrated).
 *
 * This mirrors the reputation store the procurement layer uses to filter
 * providers: providers scoring below 3 are excluded from discovery results.
 */
export interface ProviderReputation {
  provider: string;
  score: number;
  reviews: number;
}

/**
 * Order supplemental fields that the provider injects at checkout time
 * (service name/description + provider reputation). Read by
 * `GET /api/orders/:id` so the client can verify what it bought.
 */
export interface OrderSupplement {
  orderId: bigint;
  serviceName?: string;
  serviceDescription?: string;
  providerReputation?: number;
}

export function zeroBytes32(): string {
  return '0x' + '00'.repeat(32);
}

export class SettlementLedger {
  private escrows = new Map<string, Escrow>();
  private mandates = new Map<number, Mandate>();
  private paymentsVerified = new Map<string, boolean>();
  private fulfillmentsVerified = new Map<string, boolean>();
  private verifiedServiceId = new Map<string, string>();
  private reputations = new Map<string, ProviderReputation>();
  private orderSupplements = new Map<string, OrderSupplement>();
  private nextMandateId = 1;

  dollars(whole: number): bigint {
    return BigInt(Math.round(whole * 1e18));
  }

  createMandate(opts: {
    owner: string;
    agentId: number;
    budget: bigint;
    serviceId: string;
    expiresAt?: number;
  }): Mandate {
    const mandate: Mandate = {
      mandateId: this.nextMandateId++,
      owner: opts.owner,
      agentId: opts.agentId,
      budget: opts.budget,
      serviceId: opts.serviceId,
      expiresAt: opts.expiresAt ?? Date.now() / 1000 + 86400,
      revoked: false,
      spent: 0n,
    };
    this.mandates.set(mandate.mandateId, mandate);
    return mandate;
  }

  revokeMandate(mandateId: number, caller: string): void {
    const m = this.mandates.get(mandateId);
    if (!m) throw new Error('MandateDoesNotExist');
    if (m.owner.toLowerCase() !== caller.toLowerCase()) throw new Error('Unauthorized');
    m.revoked = true;
  }

  isMandateValid(mandateId: number, serviceId: string, amount: bigint): boolean {
    const m = this.mandates.get(mandateId);
    if (!m) return false;
    if (m.revoked) return false;
    if (Date.now() / 1000 > m.expiresAt) return false;
    if (serviceId.toLowerCase() !== m.serviceId.toLowerCase()) return false;
    if (m.budget - m.spent < amount) return false;
    return true;
  }

  remainingBudget(mandateId: number): bigint {
    const m = this.mandates.get(mandateId);
    return m ? m.budget - m.spent : 0n;
  }

  // --- Mandate discovery (used by the procurement agent) ------------------ //

  /** First active mandate of `owner` covering `serviceId` (not revoked, not expired). */
  activeMandateOf(owner: string, serviceId: string): Mandate | undefined {
    const now = Date.now() / 1000;
    for (const m of this.mandates.values()) {
      if (m.owner.toLowerCase() !== owner.toLowerCase()) continue;
      if (m.serviceId.toLowerCase() !== serviceId.toLowerCase()) continue;
      if (m.revoked || now > m.expiresAt) continue;
      return m;
    }
    return undefined;
  }

  /** Every mandate that is still active (not revoked, not expired). */
  activeMandates(): Mandate[] {
    const now = Date.now() / 1000;
    return [...this.mandates.values()].filter((m) => !m.revoked && now <= m.expiresAt);
  }

  // --- Provider reputation ------------------------------------------------ //

  registerReputation(provider: string, score: number, reviews = 1): void {
    if (!Number.isFinite(score) || score < 0 || score > 5) throw new Error('InvalidReputation');
    this.reputations.set(provider.toLowerCase(), { provider, score: Math.round(score), reviews });
  }

  /** Star rating 1-5; 0 when the provider is unrated. */
  reputationOf(provider: string): number {
    return this.reputations.get(provider.toLowerCase())?.score ?? 0;
  }

  providerReputations(): ProviderReputation[] {
    return [...this.reputations.values()];
  }

  // --- Order supplemental fields (injected at checkout) ------------------- //

  recordOrderSupplement(orderId: bigint, supplement: Omit<OrderSupplement, 'orderId'>): void {
    this.orderSupplements.set(orderId.toString(), { orderId, ...supplement });
  }

  orderSupplement(orderId: bigint): OrderSupplement | undefined {
    return this.orderSupplements.get(orderId.toString());
  }

  createEscrow(opts: {
    orderId: bigint;
    mandateId: number;
    provider: string;
    amount: bigint;
  }): Escrow {
    const key = opts.orderId.toString();
    const existing = this.escrows.get(key);
    if (existing && existing.status !== EscrowStatus.None) throw new Error('EscrowExists');
    if (opts.amount <= 0n) throw new Error('InvalidAmount');
    const escrow: Escrow = {
      orderId: opts.orderId,
      payer: zeroAddress(), // assigned by charge method
      provider: opts.provider,
      mandateId: opts.mandateId,
      amount: opts.amount,
      status: EscrowStatus.Locked,
    };
    this.escrows.set(key, escrow);
    return escrow;
  }

  charge(opts: { orderId: bigint; payer: string }): void {
    const escrow = this.escrows.get(opts.orderId.toString());
    if (!escrow) throw new Error('EscrowNotFound');
    escrow.payer = opts.payer;
  }

  release(orderId: bigint): void {
    const escrow = this.escrows.get(orderId.toString());
    if (!escrow) throw new Error('EscrowNotFound');
    if (escrow.status !== EscrowStatus.Locked) throw new Error('InvalidStatus');
    const mandate = this.mandates.get(escrow.mandateId);
    if (!mandate) throw new Error('MandateDoesNotExist');
    if (mandate.budget - mandate.spent < escrow.amount) throw new Error('BudgetNotCompliant');
    mandate.spent += escrow.amount;
    escrow.status = EscrowStatus.Released;
  }

  refund(orderId: bigint): void {
    const escrow = this.escrows.get(orderId.toString());
    if (!escrow) throw new Error('EscrowNotFound');
    if (escrow.status !== EscrowStatus.Locked) throw new Error('InvalidStatus');
    escrow.status = EscrowStatus.Refunded;
  }

  escrowStatus(orderId: bigint): EscrowStatus {
    const escrow = this.escrows.get(orderId.toString());
    return escrow ? escrow.status : EscrowStatus.None;
  }

  escrow(orderId: bigint): Escrow | undefined {
    return this.escrows.get(orderId.toString());
  }

  // --- Attestation state (mirrors what the AttestationReceiver would set on-chain) ---

  markPaymentVerified(orderId: bigint, amount: bigint, serviceId: string, agent: string): void {
    const key = orderId.toString();
    this.paymentsVerified.set(key, true);
    this.verifiedServiceId.set(key, serviceId);
    const escrow = this.escrows.get(key);
    if (escrow) {
      escrow.payer = agent;
      if (escrow.amount !== amount) {
        throw new Error('PaymentAmountMismatch');
      }
    }
  }

  markFulfillmentVerified(orderId: bigint): void {
    this.fulfillmentsVerified.set(orderId.toString(), true);
  }

  isPaymentVerified(orderId: bigint): boolean {
    return this.paymentsVerified.get(orderId.toString()) === true;
  }

  isFulfillmentVerified(orderId: bigint): boolean {
    return this.fulfillmentsVerified.get(orderId.toString()) === true;
  }

  verifiedServiceIdOf(orderId: bigint): string {
    return this.verifiedServiceId.get(orderId.toString()) ?? zeroBytes32();
  }
}

function zeroAddress(): string {
  return '0x' + '00'.repeat(20);
}