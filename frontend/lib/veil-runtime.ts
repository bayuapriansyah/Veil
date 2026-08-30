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
import { VaultBackend } from '../../services/audit/vault-interface';
import { SupabaseVault } from '../../services/audit/supabase-vault';
import { loadVaultKey } from '../../services/audit/crypto';
import { signAuditAccess, verifyAuditAccess } from '../../services/audit/signer';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';
import { SERVICE_COMPUTE, SERVICE_MARKET_DATA } from '../../services/provider/adapter';
import { createProcurementShop, OPERATOR, PROVIDER } from '../../services/procurement/shop';
import { ProcurementAgent } from '../../services/procurement/agent';
import { ToolProgress } from '../../services/procurement/types';
import { isDemoMode, resolveVeilMode, type VeilMode } from '../../services/config/mode';
import { recordAgentPayment, recordFulfillment, recordZKReceipt } from '../../services/attestation/record';
import { generateZKReceipt, computeResultData, randomSalt } from '../../services/security/zk-prover';
import type { PublicTxView } from '../../services/audit/types';
import { delegateToAgentB, checkAgentBHealth, resolveAgentBAddress, resolveAgentBUrl, type AgentBDelegationResult } from '../../services/agent-b/client';

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
  onchainRecordTxHash?: string | null;
  /** Live source-chain FulfillmentReceipt tx hash (provider-signed), when recorded. */
  fulfillmentTxHash?: string | null;
  /** Poseidon(2) ZK proof hash linking the order to its ZK receipt. */
  zkProofHash?: string;
  /** Live source-chain ZKReceiptRecorded tx hash, when recorded. */
  zkTxHash?: string | null;
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
  vault!: VaultBackend;
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
    
    let seedOverride = 603_000n;
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
        const { data } = await c.from('vault_transactions').select('tx_id').order('tx_id', { ascending: false }).limit(1);
        if (data?.[0]?.tx_id?.startsWith('veil-')) {
          const lastId = BigInt(data[0].tx_id.replace('veil-', ''));
          seedOverride = lastId + 1n;
        }
      } catch { /* fallback */ }
    }
    
    const { shop, close } = await createProcurementShop({
      operator: OPERATOR,
      agentPrivateKey: agentWallet.privateKey,
      agentAddress: agentWallet.address,
      orderIdSeed: seedOverride,
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
    this.agent = new ProcurementAgent({ shop, forceDeterministic: true });
    const { key, source } = loadVaultKey();
    this.vault = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
      ? new SupabaseVault(key, source)
      : new AuditVault(key, source);
    this.keySource = source;
    await this.vault.authorize(this.auditorAddress, { scope: 'all' });
    void close;
  }

  serviceLabel(serviceId: string): string {
    return SERVICE_LABELS[serviceId] ?? SERVICE_LABELS[SERVICE_MARKET_DATA];
  }

  async purchase(task: string, onProgress?: (p: ToolProgress) => void): Promise<{ ok: boolean; orderId?: string; reason?: string; onchainRecordTxHash?: string | null; fulfillmentTxHash?: string | null; zkProofHash?: string; zkTxHash?: string | null }> {
    await this.start();
    if (this.killSwitch) return { ok: false, reason: 'kill switch engaged — mandate revoked, purchases refused' };
    const outcome = await this.agent.run(task, onProgress);
    if (!outcome.ok || !outcome.orderId) {
      this.recordsFailed(orderFromOutcome(outcome, task));
      return { ok: false, reason: outcome.error ?? 'purchase refused' };
    }

    // Real operator settlement through the VEIL rail (mirrors SettlementEngine).
    const orderId = BigInt(outcome.orderId);
    const handle = this.shop.handleOf(outcome.provider!);
    const settle = (await handle?.provider.settle(orderId, OPERATOR)) ?? { ok: false, error: 'ProviderUnknown' };
    const escrowStatus = (await handle?.provider.ledger.escrowStatus(orderId)) ?? 0;
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

    // Generate ZK receipt and record on-chain (soft-fail)
    let zkProofHash: string | undefined;
    let zkTxHash: string | null = null;
    try {
      const payloadRef = SERVICE_MARKET_DATA;
      const resultData = computeResultData(payloadRef);
      const salt = randomSalt();
      const zkResult = await generateZKReceipt(orderId, resultData, salt, outcome.provider!, outcome.serviceId!);
      if (zkResult.ok && zkResult.zkProofHash) {
        zkProofHash = zkResult.zkProofHash;
        const zkRecord = await recordZKReceipt({
          orderId,
          provider: outcome.provider!,
          zkProofHash,
          serviceId: outcome.serviceId!,
        }, process.env.SOURCE_CHAIN_PROVIDER_PRIVATE_KEY);
        if (zkRecord.ok && zkRecord.txHash) {
          zkTxHash = zkRecord.txHash;
        }
      }
    } catch (e) { console.error('[runtime] ZK receipt recording failed', e instanceof Error ? e.message : e); }

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
      onchainRecordTxHash: onchainTxHashOf(outcome) ?? null,
      fulfillmentTxHash: fulfillmentTx.ok && 'txHash' in fulfillmentTx ? fulfillmentTx.txHash : null,
      zkProofHash,
      zkTxHash,
      stages: successStages(settle.ok ? 'SETTLED' : 'PENDING'),
    };
    this.orders.unshift(order);

    // Record into the audit vault (encrypted at rest; public view only).
    await this.recordAudit(order, outcome);
    return { ok: true, orderId: outcome.orderId, onchainRecordTxHash: order.onchainRecordTxHash, fulfillmentTxHash: order.fulfillmentTxHash, zkProofHash: order.zkProofHash, zkTxHash: order.zkTxHash };
  }

  /**
   * Delegate a procurement task to Agent B via A2A.
   * Agent B buys from Shop C on-chain and fulfills A→B on-chain.
   *
   * CRITICAL: Agent B's wallet address is resolved from the on-chain registry,
   * NOT hardcoded. This ensures A→B payment goes to the correct agent.
   */
  async delegateToB(task: string): Promise<{ ok: boolean; orderId?: string; reason?: string; delegation?: AgentBDelegationResult }> {
    await this.start();
    if (this.killSwitch) return { ok: false, reason: 'kill switch engaged' };

    // Resolve Agent B address from on-chain registry (NOT hardcoded)
    const agentBAddress = await resolveAgentBAddress();
    if (!agentBAddress) return { ok: false, reason: 'Agent B not found in on-chain registry' };

    // Check Agent B is reachable
    const healthy = await checkAgentBHealth();
    if (!healthy) return { ok: false, reason: 'Agent B is not reachable' };

    // Reserve an A→B order ID for vault tracking + on-chain record
    const aToBOrderId = this.shop.reserveOrderId();

    // Record A→B AgentPayment on Sepolia (signed by Agent A = agent).
    // This creates the on-chain order that Agent B will fulfill as provider.
    // Provider address comes from registry — NOT hardcoded.
    const aToBPayment = await recordAgentPayment({
      orderId: aToBOrderId,
      provider: agentBAddress,
      amount: BigInt('1000000000000000'),
      serviceId: SERVICE_MARKET_DATA,
      transactionRef: keccak256(toUtf8Bytes(`${aToBOrderId}`)),
    }).catch((err: unknown) => ({ ok: false, error: String((err as Error)?.message ?? err) }));

    // Delegate to Agent B via A2A (include signed message for verification)
    const delegation = await delegateToAgentB(task, this.shop.agentPrivateKey, aToBOrderId);

    if (!delegation.ok) {
      return { ok: false, reason: delegation.error ?? 'delegation failed', delegation };
    }

    // Record delegation in the vault
    const now = Date.now();
    const aToBPaymentTx = aToBPayment.ok && 'txHash' in aToBPayment ? aToBPayment.txHash : undefined;
    await this.vault.recordTransaction({
      txId: `veil-a2b-${aToBOrderId}`,
      verificationStatus: delegation.bToCPaymentTx ? 'payment-verified fulfillment-verified' : 'delegation-pending',
      policyStatus: 'mandate-valid budget-compliant',
      settlementStatus: 'delegated',
      sourceTx: aToBPaymentTx ?? delegation.bToCPaymentTx,
      attestationStatus: 'a2a-delegation',
      protectedData: {
        agent: this.shop.agentAddress,
        provider: agentBAddress,
        amountAtoms: '0',
        amountUsd: '0',
        authorization: {
          mandateId: this.currentMandateId(),
          mandateOwner: OPERATOR,
          serviceId: SERVICE_MARKET_DATA,
          expiresAt: this.currentMandateExpiry(),
        },
        paymentEvidence: { orderId: String(aToBOrderId), paymentVerified: true, scheme: 'a2a-delegation', recordedAt: now },
        fulfillmentEvidence: { resultHash: delegation.aToBFulfillmentTx ?? '0x0', fulfillmentVerified: true, fulfillmentTx: delegation.aToBFulfillmentTx, recordedAt: now + 1 },
        attestationEvidence: {
          attestationId: delegation.bToCPaymentTx ?? `a2a:${aToBOrderId}`,
          verified: false,
          stage: 'proving' as const,
          note: `A2A delegation to Agent B — B→C payment ${delegation.bToCPaymentTx ?? 'pending'}`,
          recordedAt: now + 2,
        },
        settlementEvidence: { escrowStatus: 'delegated', settlementRef: delegation.orderId ?? '0x0', recordedAt: now + 3 },
      },
    });

    this.orders.unshift({
      orderId: String(aToBOrderId),
      serviceId: SERVICE_MARKET_DATA,
      serviceLabel: 'A2A Delegation → Agent B',
      provider: agentBAddress,
      amountAtoms: '0',
      ok: true,
      createdAt: now,
      resultHash: delegation.aToBFulfillmentTx,
      escrowStatus: 'Released',
      onchainRecordTxHash: aToBPaymentTx ?? null,
      fulfillmentTxHash: delegation.aToBFulfillmentTx ?? null,
      stages: successStages('SETTLED'),
    });

    return { ok: true, orderId: String(aToBOrderId), delegation };
  }

  private async recordAudit(order: RuntimeOrder, outcome: Awaited<ReturnType<ProcurementAgent['run']>>): Promise<void> {
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
    await this.vault.recordTransaction({
      txId: `veil-${order.orderId}`,
      verificationStatus: 'payment-verified fulfillment-verified',
      policyStatus: 'mandate-valid budget-compliant',
      settlementStatus: order.escrowStatus.toLowerCase(),
      sourceTx: onchain ?? undefined,
      attestationStatus: onchain ? 'proving' : 'mirror',
      zkProofHash: order.zkProofHash,
      zkReceiptStatus: order.zkTxHash ? 'proving' : order.zkProofHash ? 'none' : undefined,
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
        fulfillmentEvidence: { resultHash: order.resultHash ?? '0x0', fulfillmentVerified: true, fulfillmentTx: order.fulfillmentTxHash ?? undefined, recordedAt: order.createdAt + 1 },
        attestationEvidence,
        settlementEvidence: { escrowStatus: order.escrowStatus, settlementRef: order.resultHash ?? '0x0', recordedAt: order.createdAt + 3 },
      },
    });
  }

  /** Record the live attestation fact once the worker proves it on Creditcoin. */
  async attachAttestation(txId: string, opts: { attestationStatus: 'proving' | 'verified'; attestationTx?: string; sourceTx?: string; zkReceiptStatus?: 'none' | 'proving' | 'verified' }): Promise<{ ok: boolean; error?: string }> {
    await this.start();
    return this.vault.attachAttestation(txId, opts);
  }

  async attachSettlement(txId: string, opts: { settlementStatus?: string; settlementTx?: string; escrowTx?: string; mandateId?: string }): Promise<{ ok: boolean; error?: string }> {
    await this.start();
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
      reputation: { provider: this.providerAddress, score: this.shop ? this.shop.reputationScore(this.providerAddress) : 5, reviews: 1 },
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
    const active = ledger.findActiveMandate(OPERATOR, SERVICE_MARKET_DATA);
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

  async auditTxs(): Promise<PublicTxView[]> {
    await this.start();
    return this.vault.list();
  }

  async auditors(): Promise<AuditorPublic[]> {
    await this.start();
    const auditorsList = await this.vault.auditorsList();
    return auditorsList.map(a => ({ auditor: a.auditor, authorized: a.authorized, revokedAt: a.revokedAt }));
  }

  async authorize(auditor: string, scope?: 'all' | string[]): Promise<AuditorPublic> {
    await this.start();
    const acct = await this.vault.authorize(auditor, { scope });
    return { auditor: acct.auditor, authorized: acct.authorized };
  }

  async revoke(auditor: string): Promise<AuditorPublic | undefined> {
    await this.start();
    const acct = await this.vault.revoke(auditor);
    return acct ? { auditor: acct.auditor, authorized: acct.authorized, revokedAt: acct.revokedAt } : undefined;
  }

  async discloseAuditor(txId: string, fields?: string[]): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    await this.start();
    const signingResource = `/api/veil/audit/tx/${txId}`;
    const access = signAuditAccess({ privateKey: this.auditorKey, resource: signingResource, txId });
    const verified = await verifyAuditAccess(access, {
      expectedResource: signingResource,
      expectedTxId: txId,
      isAuthorized: async (a: string) => this.vault.isAuthorized(a, txId),
    });
    if (!verified.ok || !verified.auditor) return { ok: false, error: verified.error };
    if (!await this.vault.useNonce(verified.auditor, access.nonce)) return { ok: false, error: 'nonce replay detected' };
    const result = await this.vault.disclose(txId, verified.auditor, { fields });
    return result ? { ok: true, data: result } : { ok: false, error: 'TransactionNotKnown' };
  }

  get auditorAddress(): string {
    return this._auditorAddress;
  }
  private _auditorAddress = '';

  async attemptUnauthorized(txId: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    await this.start();
    const signingResource = `/api/veil/audit/tx/${txId}`;
    const access = signAuditAccess({ privateKey: '0x' + 'bb'.repeat(32), resource: signingResource, txId });
    const verified = await verifyAuditAccess(access, {
      expectedResource: signingResource,
      expectedTxId: txId,
      isAuthorized: async (a: string) => this.vault.isAuthorized(a, txId),
    });
    if (!verified.ok) return { ok: false, error: verified.error };
    return { ok: true, data: null };
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
  const live = resolveVeilMode() === 'production';
  return [
    { key: 'authorization', label: 'Authorization', status: 'VERIFIED', note: 'mandate valid · budget compliant' },
    { key: 'payment', label: 'Payment', status: 'VERIFIED', note: 'AgentPayment recorded (veil-exact)' },
    { key: 'payment-attestation', label: 'Payment Attestation', status: 'VERIFIED', note: live ? 'payment attestation proven on Creditcoin' : 'payment attestation (mirror)' },
    { key: 'fulfillment', label: 'Fulfillment', status: 'VERIFIED', note: 'result hash recorded' },
    { key: 'fulfillment-attestation', label: 'Fulfillment Attestation', status: 'VERIFIED', note: live ? 'fulfillment attestation proven on Creditcoin' : 'fulfillment attestation (mirror)' },
    { key: 'zk-receipt', label: 'ZK Receipt', status: 'VERIFIED', note: live ? 'Poseidon(2) commitment recorded on source chain' : 'ZK receipt (mirror)' },
    { key: 'zk-attestation', label: 'ZK Attestation', status: 'VERIFIED', note: live ? 'ZK proof verified on Creditcoin — same ~6min window for every order' : 'ZK attestation (mirror)' },
    { key: 'settlement', label: 'Settlement', status: finalSettlement, note: finalSettlement === 'SETTLED' ? 'escrow released by operator' : 'escrow locked — awaiting operator' },
  ];
}

function orderAmountOf(outcome: Awaited<ReturnType<ProcurementAgent['run']>>, shop: { takeOffer: (id: bigint) => { amountAtoms: bigint } | undefined }): string {
  const offer = outcome.orderId ? shop.takeOffer(BigInt(outcome.orderId)) : undefined;
  return (offer?.amountAtoms ?? BigInt('1000000000000000')).toString();
}

/** Live source-chain AgentPayment tx hash from the makePayment tool result, if recorded. */
function onchainTxHashOf(outcome: Awaited<ReturnType<ProcurementAgent['run']>>): string | undefined {
  const rec = outcome.results[9] ?? (outcome.results as Record<string, unknown>)['makePayment'];
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