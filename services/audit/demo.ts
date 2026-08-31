/**
 * VEIL Phase 7 demo — privacy & audit boundary.
 *
 * Run: npm run demo:audit
 *
 * Story:
 *   1. operator records a transaction (sensitive metadata sealed with AES-256-GCM)
 *   2. the PUBLIC UI renders only txId / commitment / verification / policy /
 *      settlement status — never decrypted private data
 *   3. an UNAUTHORIZED auditor (valid EIP-712 signature, no grant) is denied
 *   4. an AUTHORIZED auditor discloses a FIELD SUBSET (selective disclosure)
 *   5. the authorized auditor fetches the full EVIDENCE BUNDLE
 *   6. revoking the auditor stops further disclosure
 *
 * Boundary reminder printed throughout: Attestcoin verifies cross-chain facts;
 * VEIL controls disclosure. Attestcoin is NOT a privacy layer.
 */
import { Wallet } from 'ethers';
import { startAuditServer, base64Json, signAuditAccess } from './server';
import { loadVaultKey } from './crypto';
import { ProtectedData } from './types';
import { SERVICE_MARKET_DATA } from '../provider/adapter';

const OPERATOR = '0x' + '11'.repeat(20);
const PROVIDER = '0x' + '22'.repeat(20);
const AGENT = '0x' + '33'.repeat(20);
const AUDITOR_KEY = '0x' + 'aa'.repeat(32);
const AUDITOR = new Wallet(AUDITOR_KEY).address;
const INTRUDER_KEY = '0x' + 'cc'.repeat(32);
const INTRUDER = new Wallet(INTRUDER_KEY).address;

function orderProtected(orderId: string): ProtectedData {
  return {
    agent: AGENT,
    provider: PROVIDER,
    amountAtoms: '1000000000000000',
    amountUsd: '0.001',
    salt: '0x' + '01'.repeat(32),
    commitment: '0x' + 'ab'.repeat(32),
    authorization: { mandateId: 1, mandateOwner: OPERATOR, serviceId: SERVICE_MARKET_DATA, expiresAt: 4_102_444_800 },
    paymentEvidence: { orderId, paymentVerified: true, scheme: 'veil-exact', recordedAt: 1_700_000_000 },
    fulfillmentEvidence: { resultHash: '0x' + 'f'.repeat(64), fulfillmentVerified: true, recordedAt: 1_700_000_001 },
    attestationEvidence: {
      attestationId: '0x' + 'a'.repeat(64),
      verified: true,
      note: 'attestation verifies the cross-chain fact; it does NOT grant privacy',
      recordedAt: 1_700_000_002,
    },
    settlementEvidence: { escrowStatus: 'Locked', settlementRef: '0x' + 'c'.repeat(64), recordedAt: 1_700_000_003 },
  };
}

export async function runAuditDemo(): Promise<void> {
  const { key, source } = loadVaultKey();
  const started = await startAuditServer({ operatorAddress: OPERATOR, vaultKey: key });
  const base = `http://127.0.0.1:${started.port}`;
  const txId = 'tx-1189';

  console.log('=== VEIL Phase 7: privacy & audit layer ===');
  console.log(`vault key           : ${source} (never hardcoded; VEIL_VAULT_KEY or VEIL_VAULT_KEY_FILE otherwise)`);
  console.log(`operator            : ${OPERATOR}`);

  console.log('\n[1] Operator records the transaction (sensitive metadata sealed):');
  const rec = await fetch(`${base}/api/audit/vault`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-operator': OPERATOR },
    body: JSON.stringify({
      txId,
      verificationStatus: 'payment-verified fulfilment-verified',
      policyStatus: 'mandate-valid budget-compliant',
      settlementStatus: 'locked',
      protectedData: orderProtected(txId),
    }),
  });
  const recorded = (await rec.json()) as { txId: string; commitment: string; sealed: { alg: string; ct: string } };
  console.log(`  -> txId=${recorded.txId} commitment=${recorded.commitment.slice(0, 18)}…`);
  console.log(`  -> sealed: alg=${recorded.sealed.alg} (${recorded.sealed.ct.length} base64 ct chars, no plaintext)`);

  console.log('\n[2] Public UI — only the public view (no credentials held in the UI):');
  const pub = (await (await fetch(`${base}/api/audit/tx/${txId}`)).json()) as Record<string, unknown>;
  console.log(`  -> ${JSON.stringify(pub)}`);
  console.log(`  -> (any agent/provider/amount fields present? ${'agent' in pub || 'provider' in pub || 'amountAtoms' in pub})`);

  console.log('\n[3] Unauthorized auditor (valid signature, no grant) — denied:');
  const path = `/api/audit/disclosure/${txId}`;
  const intruderAccess = signAuditAccess({ privateKey: INTRUDER_KEY, resource: path, txId });
  const intruder = await fetch(`${base}${path}`, { headers: { 'x-audit-auth': base64Json(intruderAccess), 'x-auditor': INTRUDER } });
  console.log(`  -> HTTP ${intruder.status} ${JSON.stringify(await intruder.json())}`);

  console.log('\n[4] Operator authorizes an auditor, who requests SELECTIVE disclosure:');
  await fetch(`${base}/api/audit/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-operator': OPERATOR },
    body: JSON.stringify({ auditor: AUDITOR }),
  });
  const selPath = `/api/audit/disclosure/${txId}?fields=agent,amountUsd,authorization`;
  const access = signAuditAccess({ privateKey: AUDITOR_KEY, resource: selPath.split('?')[0], txId });
  const sel = await fetch(`${base}${selPath}`, { headers: { 'x-audit-auth': base64Json(access), 'x-auditor': AUDITOR } });
  const selBody = (await sel.json()) as { protectedData: Record<string, unknown> };
  console.log(`  -> HTTP ${sel.status} fields=${Object.keys(selBody.protectedData).join(',')}`);
  console.log(`  -> ${JSON.stringify(selBody.protectedData)}`);

  console.log('\n[5] Evidence bundle (full audit):');
  const evPath = `/api/audit/evidence/${txId}`;
  const evAccess = signAuditAccess({ privateKey: AUDITOR_KEY, resource: evPath, txId });
  const evidence = (await (await fetch(`${base}${evPath}`, { headers: { 'x-audit-auth': base64Json(evAccess), 'x-auditor': AUDITOR } })).json()) as {
    evidence: { payment: unknown; fulfillment: unknown; attestation: unknown; settlement: unknown };
  };
  console.log(`  -> payment:       ${JSON.stringify(evidence.evidence.payment)}`);
  console.log(`  -> fulfillment:   ${JSON.stringify(evidence.evidence.fulfillment)}`);
  console.log(`  -> attestation:   ${JSON.stringify(evidence.evidence.attestation)}`);
  console.log(`  -> settlement:    ${JSON.stringify(evidence.evidence.settlement)}`);

  console.log('\n[6] Revoke + re-disclose — denied:');
  await fetch(`${base}/api/audit/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-operator': OPERATOR },
    body: JSON.stringify({ auditor: AUDITOR }),
  });
  const after = await fetch(`${base}${path}`, { headers: { 'x-audit-auth': base64Json(signAuditAccess({ privateKey: AUDITOR_KEY, resource: path, txId })), 'x-auditor': AUDITOR } });
  console.log(`  -> HTTP ${after.status} ${JSON.stringify(await after.json())}`);
  const pubAfter = (await (await fetch(`${base}/api/audit/tx/${txId}`)).json()) as { txId: string; settlementStatus: string };
  console.log(`  -> public view still 200: ${pubAfter.txId} / ${pubAfter.settlementStatus}`);

  console.log('\nBoundary: Attestcoin verifies cross-chain facts; VEIL controls disclosure.');
  console.log('Attestcoin does NOT provide privacy — AES-256-GCM at rest + authorization here does.');
  await started.close();
}

if (require.main === module) {
  runAuditDemo().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}