/**
 * VEIL runtime — the SERVER-SIDE singleton that actually performs transactions.
 *
 * It constructs the real Phase 3-5 stack in-process (ProcurementShop + agent +
 * SettlementLedger over the real x402 HTTP rail) and the Phase 7 audit vault,
 * then serves the UI through route handlers. Every purchase here is a REAL
 * purchase through the VEIL rail: discovery -> requestService -> makePayment ->
 * operator settle -> audit record.
 *
 * Honesty rule (Phase 8): the raw `asc`/attestation step is mirrored in the
 * SettlementLedger for this demo; we never claim a live on-chain event that did
 * not happen. The UI labels attestation state as "mirror".
 */
import { AuditVault } from '../../services/audit/vault';
import { loadVaultKey } from '../../services/audit/crypto';
import { signAuditAccess, verifyAuditAccess } from '../../services/audit/signer';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';
import { SERVICE_COMPUTE, SERVICE_MARKET_DATA } from '../../services/provider/adapter';
import { createProcurementShop, OPERATOR, PROVIDER } from '../../services/procurement/shop';
import { ProcurementAgent } from '../../services/procurement/agent';
import { isDemoMode, resolveVeilMode, type VeilMode } from '../../services/config/mode';
import { recordFulfillment } from '../../services/attestation/record';

export const PRICE_ATOMS = BigInt('1000000000000000'); // 0.001 per call
export const BUDGET_ATOMS = PRICE_ATOMS * 40n;

export type TxStatus = 'PENDING' | 'VERIFIED' | 'FAILED' | 'REJECTED' | 'REFUNDED' | 'SETTLED';

export interface TimelineStage {
  key: string;
  label: string;
  status: TxStatus;
  note?: string;
}

export interface RuntimeOrder {
  orderId: string;
  serviceId: string;
  serviceLabel: string;
  provider: string;
  amountAtoms: string;
  ok: boolean;
  createdAt: number;
  resultHash?: string;
  error?: string;
  escrowStatus: 'None' | 'Locked' | 'Released' | 'Refunded';
  /** Live source-chain AgentPayment tx hash, when the on-chain record succeeded. */
  onchainRecordTxHash?: string;
  /** Live source-chain FulfillmentReceipt tx hash (provider-signed), when recorded. */
  fulfillmentTxHash?: string;
  stages: TimelineStage[];
}

export interface RuntimeState {
  agent: { address: string; status: 'active' | 'killed' };
  killSwitch: boolean;
  budgetAtoms: string;
  spentAtoms: string;
  remainingAtoms: string;
  reservedAtoms: string;
  reputation: { provider: string; score: number; reviews: number };
  verifiedTransactions: number;
  transactionCount: number;
  currentMandate: MandatePublic | null;
  providersCount: number;
  orderIds: string[];
  keySource: string;
  txsAtoms: string; // "total value" settled, human label
  mode: VeilMode;
}

export interface MandatePublic {
  mandateId: number;
  owner: string;
  serviceId: string;
  serviceLabel: string;
  budgetAtoms: string;
  spentAtoms: string;
  remainingAtoms: string;
  expiresAt: number;
  revoked: boolean;
}

export interface ProviderPublic {
  provider: string;
  reputation: number;
  eligible: boolean;
  services: Array<{ serviceId: string; name: string; description: string; pricePerCallAtoms: string }>;
  activeMandates: number;
}

export interface AuditorPublic {
  auditor: string;
  authorized: boolean;
  revokedAt?: number;
}

const SERVICE_LABELS: Record<string, string> = {
  [SERVICE_MARKET_DATA]: 'Market Data Feed',
  [SERVICE_COMPUTE]: 'Compute Rentals',
};

class VeilRuntime {
  shop!: Awaited<ReturnType<typeof createProcurementShop>>['shop'];
  agent!: ProcurementAgent;
  vault!: AuditVault;
  killSwitch = false;
  orders: RuntimeOrder[] = [];
  auditorKey = '0x' + 'aa'.repeat(32); // demo auditor wallet (runtime-side, not shipped as a secret)
  keySource = 'ephemeral';
  /** The on-chain-capable provider (real signing wallet in production). */
  providerAddress = PROVIDER;
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this._auditorAddress = new Wallet(this.auditorKey).address;
    // Identity provisioning is MODE-AWARE:
    //  - demo:       generate a fresh agent wallet (no env keys, no funding).
    //  - production: the agent identity IS the funded source-chain wallet, so
    //                the x402 payer and the on-chain record signer are one.
    const demo = isDemoMode();
    const agentWallet = demo
      ? Wallet.createRandom()
      : new Wallet(process.env.SOURCE_CHAIN_WALLET_PRIVATE_KEY ?? Wallet.createRandom().privateKey);
    // Production provider identity = the wallet that signs on-chain fulfillments.
    this.providerAddress = process.env.VEIL_PROVIDER_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(process.env.VEIL_PROVIDER_ADDRESS)
      ? process.env.VEIL_PROVIDER_ADDRESS
      : PROVIDER;
    const { shop, close } = await createProcurementShop({
      operator: OPERATOR,
      agentPrivateKey: agentWallet.privateKey,
      agentAddress: agentWallet.address,
      // Start auto-assigned order ids high so restarts never collide with
      // already-recorded on-chain AgentPayment events (soft-fail avoided).
      // 600000 was already recorded + proven on Creditcoin; the next live
      // settlement run uses 601000+. Agent-to-agent reserves 700_000n+.
      orderIdSeed: 601_000n,
      providers: [
        // Provider[0] is the ON-CHAIN provider: in production its address comes
        // from VEIL_PROVIDER_ADDRESS and its key from SOURCE_CHAIN_PROVIDER_PRIVATE_KEY,
        // so it can sign the live FulfillmentReceipt (VeilSource.recordFulfillment
        // is onlyProvider-guarded). In demo it falls back to the fixed mirror key.
        { address: this.providerAddress, reputation: 5, services: [{ serviceId: SERVICE_MARKET_DATA, name: 'Market Data Feed', description: 'Real-time market data (per-call)', pricePerCallAtoms: PRICE_ATOMS }] },
        { address: '0x' + '44'.repeat(20), reputation: 5, services: [{ serviceId: SERVICE_MARKET_DATA, name: 'Market Data Feed', description: 'High-priced redundant feed', pricePerCallAtoms: PRICE_ATOMS * 3n }] },
        { address: '0x' + '55'.repeat(20), reputation: 2, services: [{ serviceId: SERVICE_MARKET_DATA, name: 'Market Data Feed', description: 'Untrusted feed', pricePerCallAtoms: PRICE_ATOMS }] },
      ],
    });
    shop.createMandate({
      serviceId: SERVICE_MARKET_DATA,
      budgetAtoms: BUDGET_ATOMS,
      owner: OPERATOR,
    });
    this.shop = shop;
    this.agent = new ProcurementAgent({ shop, forceDeterministic: true }); // deterministic unless env key permits LLM
    const { key, source } = loadVaultKey();
    this.vault = new AuditVault(key, source);
    this.keySource = source;
    // Authorize the runtime-owned demo auditor ONCE, with an explicit scope.
    // This is the demo's standing grant — the vault decides disclosures from
    // here on; this is NOT re-granted per disclosure (see discloseAuditor).
    this.vault.authorize(this.auditorAddress, { scope: 'all' });
    void close;
  }

  serviceLabel(serviceId: string): string {
    return SERVICE_LABELS[serviceId] ?? SERVICE_LABELS[SERVICE_MARKET_DATA];
  }

  async purchase(task: string): Promise<{ ok: boolean; orderId?: string; reason?: string; onchainRecordTxHash?: string }> {
    await this.start();
    if (this.killSwitch) return { ok: false, reason: 'kill switch engaged — mandate revoked, purchases refused' };
    const outcome = await this.agent.run(task);
    if (!outcome.ok || !outcome.orderId) {
      this.recordsFailed(orderFromOutcome(outcome, task));
      return { ok: false, reason: outcome.error ?? 'purchase refused' };
    }

    // Real operator settlement through the VEIL rail (mirrors SettlementEngine).
    const orderId = BigInt(outcome.orderId);
    const handle = this.shop.handleOf(outcome.provider!);
    const settle = handle?.provider.settle(orderId, OPERATOR) ?? { ok: false, error: 'ProviderUnknown' };
    const escrowStatus = handle?.provider.ledger.escrowStatus(orderId) ?? 0;
    const resultHash = handle?.provider.adapter.computeResultHash({
      orderId,
      serviceId: outcome.serviceId!,
      provider: outcome.provider!,
      payloadRef: SERVICE_MARKET_DATA,
    });

    // Record the live FulfillmentReceipt on Sepolia, SIGNED BY THE PROVIDER
    // (VeilSource.recordFulfillment is onlyProvider-guarded, so the provider
    // wallet — not the agent — must sign). Soft-fail: the mirror ledger stays
    // authoritative for the UI. The Attestcoin worker proves this block next,
    // giving the SettlementEngine both facts to settle on Creditcoin.
    const fulfillmentTx = await recordFulfillment(
      {
        orderId,
        resultHash: resultHash ?? '0x' + '0'.repeat(64),
        serviceId: outcome.serviceId!,
        transactionRef: keccak256(toUtf8Bytes(`${orderId}`)),
      },
      process.env.SOURCE_CHAIN_PROVIDER_PRIVATE_KEY,
    ).catch((err: unknown) => ({ ok: false, error: String((err as Error)?.message ?? err) }));

    const order: RuntimeOrder = {
      orderId: outcome.orderId,
      serviceId: outcome.serviceId!,
      serviceLabel: this.serviceLabel(outcome.serviceId!),
      provider: outcome.provider!,
      amountAtoms: orderAmountOf(outcome, this.shop),
      ok: settle.ok,
      createdAt: Date.now(),
      resultHash,
      escrowStatus: escrowStatus === 2 ? 'Released' : escrowStatus === 1 ? 'Locked' : escrowStatus === 3 ? 'Refunded' : 'None',
      onchainRecordTxHash: onchainTxHashOf(outcome),
      fulfillmentTxHash: fulfillmentTx.ok && 'txHash' in fulfillmentTx ? fulfillmentTx.txHash : undefined,
      stages: successStages(settle.ok ? 'SETTLED' : 'PENDING'),
    };
    this.orders.unshift(order);

    // Record into the audit vault (encrypted at rest; public view only).
    this.recordAudit(order, outcome);
    return { ok: true, orderId: outcome.orderId, onchainRecordTxHash: order.onchainRecordTxHash };
  }

  private recordAudit(order: RuntimeOrder, outcome: Awaited<ReturnType<ProcurementAgent['run']>>): void {
    const onchain = order.onchainRecordTxHash;
    const attestationEvidence = onchain
      ? {
        attestationId: onchain,
        verified: false,
        stage: 'proving' as const,
        note: 'AgentPayment recorded on Sepolia — worker proving the block on Creditcoin; live fact tracked in the public record',
        recordedAt: order.createdAt + 2,
      }
      : {
        attestationId: `mirror:${order.orderId}`,
        verified: true,
        stage: 'mirror' as const,
        note: 'no live on-chain record (soft-fail) — attestation state mirrored in the SettlementLedger for this demo',
        recordedAt: order.createdAt + 2,
      };
    this.vault.recordTransaction({
      txId: `veil-${order.orderId}`,
      verificationStatus: 'payment-verified fulfillment-verified',
      policyStatus: 'mandate-valid budget-compliant',
      settlementStatus: order.escrowStatus.toLowerCase(),
      sourceTx: onchain,
      attestationStatus: onchain ? 'proving' : 'mirror',
      protectedData: {
        agent: this.shop.agentAddress,
        provider: order.provider,
        amountAtoms: order.amountAtoms,
        amountUsd: atomsToUsd(order.amountAtoms),
        authorization: {
          mandateId: this.currentMandateId(),
          mandateOwner: OPERATOR,
          serviceId: order.serviceId,
          expiresAt: this.currentMandateExpiry(),
        },
        paymentEvidence: { orderId: order.orderId, paymentVerified: true, scheme: 'veil-exact', recordedAt: order.createdAt },
        fulfillmentEvidence: { resultHash: order.resultHash ?? '0x0', fulfillmentVerified: true, fulfillmentTx: order.fulfillmentTxHash, recordedAt: order.createdAt + 1 },
        attestationEvidence,
        settlementEvidence: { escrowStatus: order.escrowStatus, settlementRef: order.resultHash ?? '0x0', recordedAt: order.createdAt + 3 },
      },
    });
  }

  /** Record the live attestation fact once the worker proves it on Creditcoin. */
  attachAttestation(txId: string, opts: { attestationStatus: 'proving' | 'verified'; attestationTx?: string; sourceTx?: string }): { ok: boolean; error?: string } {
    void this.start();
    return this.vault.attachAttestation(txId, opts);
  }

  /** Record the live on-chain settlement fact once the worker settles on Creditcoin. */
  attachSettlement(txId: string, opts: { settlementStatus?: string; settlementTx?: string; escrowTx?: string; mandateId?: string }): { ok: boolean; error?: string } {
    void this.start();
    return this.vault.attachSettlement(txId, opts);
  }

  recordsFailed(order: RuntimeOrder): void {
    this.orders.unshift(order);
  }

  async kill(): Promise<void> {
    await this.start();
    this.killSwitch = true;
    for (const { ledger } of this.shop.ledgers()) {
      for (const m of ledger.activeMandates()) ledger.revokeMandate(m.mandateId, OPERATOR);
    }
  }

  state(): RuntimeState {
    void this.start();
    let spent = 0n;
    let budget = 0n;
    for (const { ledger } of this.shop?.ledgers?.() ?? []) {
      for (const m of ledger.activeMandates()) {
        budget += m.budget;
        spent += m.spent;
      }
    }
    if (budget === 0n) {
      // after revoke, activeMandates is empty — read the last known mandate instead.
      for (const { ledger } of this.shop?.ledgers?.() ?? []) {
        const all = (ledger as unknown as { mandates: Map<number, { budget: bigint; spent: bigint }> }).mandates;
        for (const m of all.values()) {
          budget += m.budget;
          spent += m.spent;
        }
      }
    }
    const verified = this.orders.filter((o) => o.ok).length;
    return {
      agent: { address: this.shop?.agentAddress ?? '0x0000000000000000000000000000000000000000', status: this.killSwitch ? 'killed' : 'active' },
      killSwitch: this.killSwitch,
      budgetAtoms: budget.toString(),
      spentAtoms: spent.toString(),
      remainingAtoms: (budget - spent).toString(),
      reservedAtoms: this.reserved().toString(),
      reputation: { provider: this.providerAddress, score: this.shop ? this.shop.reputationOf(this.providerAddress) : 5, reviews: 1 },
      verifiedTransactions: verified,
      transactionCount: this.orders.length,
      currentMandate: this.currentMandate(),
      providersCount: this.shop?.catalog().length ?? 0,
      orderIds: this.orders.map((o) => o.orderId),
      keySource: this.keySource,
      txsAtoms: spent.toString(),
      mode: resolveVeilMode(),
    };
  }

  private reserved(): bigint {
    let reserved = 0n;
    for (const o of this.orders) if (!o.ok && o.escrowStatus === 'Locked') reserved += BigInt(o.amountAtoms);
    return reserved;
  }

  private currentMandateId(): number {
    return this.currentMandate()?.mandateId ?? 1;
  }

  private currentMandateExpiry(): number {
    return this.currentMandate()?.expiresAt ?? Date.now() / 1000 + 86400;
  }

  currentMandate(): MandatePublic | null {
    if (!this.shop) return null;
    const ledger = this.shop.ledgerOf(this.providerAddress);
    if (!ledger) return null;
    const active = ledger.activeMandateOf(OPERATOR, SERVICE_MARKET_DATA);
    const fallback = active ?? (ledger as unknown as { mandates: Map<number, { mandateId: number; owner: string; serviceId: string; budget: bigint; spent: bigint; expiresAt: number; revoked: boolean }> }).mandates.values().next().value;
    const m = active ?? fallback;
    if (!m) return null;
    return {
      mandateId: m.mandateId,
      owner: m.owner,
      serviceId: m.serviceId,
      serviceLabel: this.serviceLabel(m.serviceId),
      budgetAtoms: m.budget.toString(),
      spentAtoms: m.spent.toString(),
      remainingAtoms: (m.budget - m.spent).toString(),
      expiresAt: m.expiresAt,
      revoked: m.revoked,
    };
  }

  providers(): ProviderPublic[] {
    if (!this.shop) return [];
    return this.shop.catalog().map((o) => {
      const prof = this.shop.providerProfile(o.provider);
      return {
        provider: o.provider,
        reputation: o.reputation,
        eligible: o.reputation >= 3,
        services: prof?.services.filter((s) => s.provider.toLowerCase() === o.provider.toLowerCase()).map((s) => ({
          serviceId: s.serviceId,
          name: s.name,
          description: s.description,
          pricePerCallAtoms: s.pricePerCallAtoms.toString(),
        })) ?? [],
        activeMandates: prof?.activeMandates ?? 0,
      };
    });
  }

  ordersList(): RuntimeOrder[] {
    return this.orders;
  }

  order(orderId: string): RuntimeOrder | undefined {
    return this.orders.find((o) => o.orderId === orderId);
  }

  // --- audit API (real vault + signed auditor flow) ---------------------- //

  auditTxs(): Array<{ txId: string; commitment: string; verificationStatus: string; policyStatus: string; settlementStatus: string; createdAt: number; encrypted: boolean }> {
    void this.start();
    return this.vault.list();
  }

  auditors(): AuditorPublic[] {
    void this.start();
    const registry = (this.vault as unknown as { auditors: Map<string, AuditorPublic> }).auditors;
    return [...registry.values()];
  }

  authorize(auditor: string, scope?: 'all' | string[]): AuditorPublic {
    void this.start();
    const acct = this.vault.authorize(auditor, { scope });
    return { auditor: acct.auditor, authorized: acct.authorized };
  }

  revoke(auditor: string): AuditorPublic | undefined {
    void this.start();
    const acct = this.vault.revoke(auditor);
    return acct ? { auditor: acct.auditor, authorized: acct.authorized, revokedAt: acct.revokedAt } : undefined;
  }

  /** Selective disclosure performed through the real EIP-712 AuditAccess flow. */
  discloseAuditor(txId: string, fields?: string[]): { ok: boolean; data?: unknown; error?: string } {
    void this.start();
    // NOTE: the demo auditor was authorized once in start(); no re-authorization
    // happens here. Authorization is an operator action, not a disclosure action.
    const signingResource = `/api/veil/audit/tx/${txId}`;
    const access = signAuditAccess({ privateKey: this.auditorKey, resource: signingResource, txId });
    const verified = verifyAuditAccess(access, {
      expectedResource: signingResource,
      expectedTxId: txId,
      isAuthorized: (a) => this.vault.isAuthorized(a, txId),
    });
    if (!verified.ok || !verified.auditor) return { ok: false, error: verified.error };
    if (!this.vault.useNonce(verified.auditor, access.nonce)) return { ok: false, error: 'nonce replay detected' };
    const result = this.vault.disclose(txId, verified.auditor, { fields });
    return result ? { ok: true, data: result } : { ok: false, error: 'TransactionNotKnown' };
  }

  get auditorAddress(): string {
    return this._auditorAddress;
  }
  private _auditorAddress = '';

  /** Unauthorized-auditor demo: a key the vault never authorized must be refused. */
  attemptUnauthorized(txId: string): { ok: boolean; data?: unknown; error?: string } {
    void this.start();
    const signingResource = `/api/veil/audit/tx/${txId}`;
    const access = signAuditAccess({ privateKey: '0x' + 'bb'.repeat(32), resource: signingResource, txId });
    const verified = verifyAuditAccess(access, {
      expectedResource: signingResource,
      expectedTxId: txId,
      isAuthorized: (a) => this.vault.isAuthorized(a, txId),
    });
    if (!verified.ok) return { ok: false, error: verified.error };
    return { ok: true, data: null }; // unreachable while the vault refuses unknown auditors
  }

  protections(): void {}
}

function orderFromOutcome(outcome: Awaited<ReturnType<ProcurementAgent['run']>>, task: string): RuntimeOrder {
  return {
    orderId: outcome.orderId ?? 'refused',
    serviceId: outcome.serviceId ?? '',
    serviceLabel: SERVICE_LABELS[outcome.serviceId ?? ''] ?? 'Market Data Feed',
    provider: outcome.provider ?? '',
    amountAtoms: '0',
    ok: false,
    createdAt: Date.now(),
    error: outcome.error ?? 'refused',
    escrowStatus: 'None',
    stages: [
      { key: 'authorization', label: 'Authorization', status: 'REJECTED', note: outcome.error },
      { key: 'payment', label: 'Payment', status: 'PENDING' },
      { key: 'payment-attestation', label: 'Attestation', status: 'PENDING' },
      { key: 'fulfillment', label: 'Fulfillment', status: 'PENDING' },
      { key: 'fulfillment-attestation', label: 'Attestation', status: 'PENDING' },
      { key: 'settlement', label: 'Settlement', status: 'PENDING' },
    ],
  };
}

function successStages(finalSettlement: 'SETTLED' | 'PENDING'): TimelineStage[] {
  return [
    { key: 'authorization', label: 'Authorization', status: 'VERIFIED', note: 'mandate valid · budget compliant' },
    { key: 'payment', label: 'Payment', status: 'VERIFIED', note: 'AgentPayment recorded (veil-exact)' },
    { key: 'payment-attestation', label: 'Attestation', status: 'VERIFIED', note: 'payment attestation (mirror)' },
    { key: 'fulfillment', label: 'Fulfillment', status: 'VERIFIED', note: 'result hash recorded' },
    { key: 'fulfillment-attestation', label: 'Attestation', status: 'VERIFIED', note: 'fulfillment attestation (mirror)' },
    { key: 'settlement', label: 'Settlement', status: finalSettlement, note: finalSettlement === 'SETTLED' ? 'escrow released by operator' : 'escrow locked — awaiting operator' },
  ];
}

function orderAmountOf(outcome: Awaited<ReturnType<ProcurementAgent['run']>>, shop: { takeOffer: (id: bigint) => { amountAtoms: bigint } | undefined }): string {
  const offer = outcome.orderId ? shop.takeOffer(BigInt(outcome.orderId)) : undefined;
  return (offer?.amountAtoms ?? BigInt('1000000000000000')).toString();
}

/** Live source-chain AgentPayment tx hash from the makePayment tool result, if recorded. */
function onchainTxHashOf(outcome: Awaited<ReturnType<ProcurementAgent['run']>>): string | undefined {
  // The deterministic plan records results keyed by STEP INDEX (makePayment = 8),
  // but accept the tool-name key defensively too.
  const rec = outcome.results[8] ?? (outcome.results as Record<string, unknown>)['makePayment'];
  const data = (rec as { data?: { onchain?: { txHash?: string } } } | undefined)?.data;
  return data?.onchain?.txHash;
}

export function atomsToUsd(atoms: string | bigint): string {
  const n = Number(BigInt(atoms)) / 1e18;
  return n.toFixed(3);
}

const RUNTIME_KEY = '__veilRuntimeSingleton__';

/**
 * Next bundles each route handler separately, so module-level state in this
 * file would be instantiated once per route. anchoring the runtime on
 * globalThis guarantees all /api/veil/* routes drive the SAME rail.
 */
export async function getRuntime(): Promise<VeilRuntime> {
  const g = globalThis as unknown as Record<string, VeilRuntime | undefined>;
  if (!g[RUNTIME_KEY]) g[RUNTIME_KEY] = new VeilRuntime();
  const rt = g[RUNTIME_KEY] as VeilRuntime;
  await rt.start();
  return rt;
}

export { SERVICE_MARKET_DATA };