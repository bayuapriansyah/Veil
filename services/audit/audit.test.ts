/**
 * VEIL Phase 7 — privacy & audit layer tests.
 *
 * Required scenarios:
 *   1. unauthorized auditor  — valid signature but no grant -> 403, data sealed
 *   2. authorized auditor    — signed + granted -> full protected disclosure
 *   3. encrypted metadata    — at-rest record has NO plaintext; AES-256-GCM
 *                              tamper is detected (auth tag failure)
 *   4. successful disclosure — selective fields + evidence bundle
 *   5. revoked authorization — revoke stops disclosure; public view unaffected
 *
 * The vault key here is a TEST-ONLY fixed buffer (this is a test fixture, not a
 * secret shipped in source).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';

import { startAuditServer, base64Json, signAuditAccess } from './server';
import { openSealedBox } from './crypto';
import { AuditVault } from './vault';
import { EvidenceBundle, ProtectedData } from './types';
import { SERVICE_MARKET_DATA } from '../provider/adapter';

export const OPERATOR = '0x' + '11'.repeat(20);
export const PROVIDER = '0x' + '22'.repeat(20);
export const AGENT = '0x' + '33'.repeat(20);
export const TEST_VAULT_KEY = Buffer.alloc(32, 7); // test-only fixture key

export const AUDITOR_A_KEY = '0x' + 'aa'.repeat(32);
export const AUDITOR_A = new Wallet(AUDITOR_A_KEY).address;
export const AUDITOR_B_KEY = '0x' + 'bb'.repeat(32);
export const AUDITOR_B = new Wallet(AUDITOR_B_KEY).address;
export const INTRUDER_KEY = '0x' + 'cc'.repeat(32);
export const INTRUDER = new Wallet(INTRUDER_KEY).address;

export function sampleProtected(txId: string): ProtectedData {
  return {
    agent: AGENT,
    provider: PROVIDER,
    amountAtoms: '1000000000000000',
    amountUsd: '0.001',
    authorization: {
      mandateId: 1,
      mandateOwner: OPERATOR,
      serviceId: SERVICE_MARKET_DATA,
      expiresAt: 4_102_444_800,
    },
    paymentEvidence: { orderId: txId, paymentVerified: true, scheme: 'veil-exact', recordedAt: 1_700_000_000 },
    fulfillmentEvidence: { resultHash: '0x' + 'f'.repeat(64), fulfillmentVerified: true, recordedAt: 1_700_000_001 },
    attestationEvidence: {
      attestationId: '0x' + 'a'.repeat(64),
      verified: true,
      note: 'attestation verifies the cross-chain fact; it does not grant privacy',
      recordedAt: 1_700_000_002,
    },
    settlementEvidence: { escrowStatus: 'Locked', settlementRef: '0x' + 'c'.repeat(64), recordedAt: 1_700_000_003 },
  };
}

interface Harness {
  baseUrl: string;
  vault: AuditVault;
  close: () => Promise<void>;
}

describe('VEIL privacy & audit layer', () => {
  let h: Harness;
  let baseUrl: string;
  let recordViaVault: (txId: string, statuses?: Partial<Record<'verificationStatus' | 'policyStatus' | 'settlementStatus', string>>) => void;

  before(async () => {
    const started = await startAuditServer({ operatorAddress: OPERATOR, vaultKey: TEST_VAULT_KEY });
    h = { baseUrl: `http://127.0.0.1:${started.port}`, vault: started.vault, close: started.close };
    baseUrl = h.baseUrl;
    recordViaVault = (txId, statuses = {}) => {
      started.vault.recordTransaction({
        txId,
        verificationStatus: statuses.verificationStatus ?? 'payment-verified fulfilment-verified',
        policyStatus: statuses.policyStatus ?? 'mandate-valid budget-compliant',
        settlementStatus: statuses.settlementStatus ?? 'locked',
        protectedData: sampleProtected(txId),
      });
    };
  });
  after(async () => {
    await h.close();
  });

  function signedFetch(resource: string, txId: string, privateKey: string, nonce?: string): Promise<Response> {
    // The auditor signs the PATH (the query string is a server-side pick).
    const path = resource.split('?')[0];
    const access = signAuditAccess({ privateKey, resource: path, txId, nonce });
    return fetch(`${baseUrl}${resource}`, {
      headers: { 'x-audit-auth': base64Json(access), 'x-auditor': access.auditor },
    });
  }

  it('1. unauthorized auditor — signed request but no grant is denied; data stays sealed', async () => {
    const txId = 'tx-0001';
    recordViaVault(txId);
    // INTRUDER signs correctly but was never authorized.
    const disclosure = await signedFetch(`/api/audit/disclosure/${txId}`, txId, INTRUDER_KEY);
    assert.equal(disclosure.status, 403);
    const denied = (await disclosure.json()) as { error: string };
    assert.match(denied.error, /disclosure denied|denied/i);

    const evidence = await signedFetch(`/api/audit/evidence/${txId}`, txId, INTRUDER_KEY);
    assert.equal(evidence.status, 403);

    // The public view is still available and leaks nothing private.
    const pubRes = await fetch(`${baseUrl}/api/audit/tx/${txId}`);
    assert.equal(pubRes.status, 200);
    const pub = (await pubRes.json()) as Record<string, unknown>;
    assert.equal(pub.txId, txId);
    assert.equal(pub.encrypted, true);
    for (const leaked of ['agent', 'provider', 'amountAtoms', 'authorization', 'paymentEvidence']) {
      assert.equal(leaked in pub, false, `public view must not expose "${leaked}"`);
    }
  });

  it('2. authorized auditor — operator grants access; auditor reads the full private record', async () => {
    const txId = 'tx-0002';
    recordViaVault(txId);
    const authorize = await fetch(`${baseUrl}/api/audit/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-operator': OPERATOR },
      body: JSON.stringify({ auditor: AUDITOR_A }),
    });
    assert.equal(authorize.status, 200);

    const disclosure = await signedFetch(`/api/audit/disclosure/${txId}`, txId, AUDITOR_A_KEY);
    assert.equal(disclosure.status, 200);
    const body = (await disclosure.json()) as { auditor: string; protectedData: ProtectedData };
    assert.equal(body.auditor.toLowerCase(), AUDITOR_A.toLowerCase());
    assert.equal(body.protectedData.agent, AGENT);
    assert.equal(body.protectedData.provider, PROVIDER);
    assert.equal(body.protectedData.amountAtoms, sampleProtected(txId).amountAtoms);
    assert.equal(body.protectedData.authorization.mandateId, 1);
    assert.equal(body.protectedData.paymentEvidence.paymentVerified, true);
  });

  it('3. encrypted metadata — no plaintext at rest; AES-256-GCM tamper is detected', async () => {
    const txId = 'tx-0003';
    recordViaVault(txId);

    // (a) The stored record must not contain any plaintext of sensitive fields.
    const rawRecord = h.vault.get(txId)!;
    const raw = JSON.stringify(rawRecord);
    for (const needle of [AGENT, PROVIDER, sampleProtected(txId).amountAtoms, '0x' + 'f'.repeat(64), OPERATOR, 'veil-exact']) {
      assert.equal(raw.includes(needle.toLowerCase()) || raw.includes(needle), false, `record leaked plaintext "${needle}"`);
    }
    assert.equal(rawRecord.protected.alg, 'AES-256-GCM');
    assert.ok(rawRecord.protected.iv && rawRecord.protected.tag && rawRecord.protected.ct);

    // (b) AES-GCM is authenticated: flipping any ciphertext byte throws (BadTag).
    const flipped = {
      ...rawRecord.protected,
      ct: flipBase64(rawRecord.protected.ct),
    };
    assert.throws(() => openSealedBox(TEST_VAULT_KEY, txId, flipped), /gcm|tag|bad decrypt|invalid|authenticate|unsupported state/i);

    // (c) Public view of this tx never includes decrypted private data.
    const pubRes = await fetch(`${baseUrl}/api/audit/tx/${txId}`);
    const pub = (await pubRes.json()) as Record<string, unknown>;
    for (const leaked of ['agent', 'provider', 'amountAtoms', 'paymentEvidence', 'resultHash']) {
      assert.equal(leaked in pub, false);
    }
  });

  it('4. successful disclosure — selective fields + full evidence bundle', async () => {
    const txId = 'tx-0004';
    recordViaVault(txId);
    await fetch(`${baseUrl}/api/audit/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-operator': OPERATOR },
      body: JSON.stringify({ auditor: AUDITOR_A }),
    });

    // Selective disclosure: ONLY the requested fields.
    const selective = await signedFetch(`/api/audit/disclosure/${txId}?fields=agent,amountAtoms,authorization`, txId, AUDITOR_A_KEY);
    assert.equal(selective.status, 200);
    const sel = (await selective.json()) as { protectedData: Record<string, unknown> };
    assert.deepEqual(Object.keys(sel.protectedData).sort(), ['agent', 'amountAtoms', 'authorization']);
    assert.equal(sel.protectedData.agent, AGENT);
    assert.equal('provider' in sel.protectedData, false);
    assert.equal('paymentEvidence' in sel.protectedData, false);

    // Evidence bundle: all four evidence types.
    const evidence = await signedFetch(`/api/audit/evidence/${txId}`, txId, AUDITOR_A_KEY);
    assert.equal(evidence.status, 200);
    const bundle = (await evidence.json()) as { evidence: EvidenceBundle };
    assert.deepEqual(Object.keys(bundle.evidence).sort(), ['attestation', 'fulfillment', 'payment', 'settlement']);
    assert.equal(bundle.evidence.payment.paymentVerified, true);
    assert.equal(bundle.evidence.fulfillment.resultHash, '0x' + 'f'.repeat(64));
    assert.equal(bundle.evidence.attestation.verified, true);
    assert.match(bundle.evidence.attestation.note, /does not grant privacy/i);
    assert.equal(bundle.evidence.settlement.escrowStatus, 'Locked');
  });

  it('5. revoked authorization — disclosure stops; nonce replay denied; public view unaffected', async () => {
    const txId = 'tx-0005';
    recordViaVault(txId);
    const authorize = await fetch(`${baseUrl}/api/audit/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-operator': OPERATOR },
      body: JSON.stringify({ auditor: AUDITOR_B }),
    });
    assert.equal(authorize.status, 200);

    // Before revoke: works.
    const resource = `/api/audit/disclosure/${txId}`;
    const before = await signedFetch(resource, txId, AUDITOR_B_KEY);
    assert.equal(before.status, 200);

    // Nonce replay is denied even while still authorized.
    const fixedNonce = '0x' + 'beef'.padStart(32, '0');
    const first = await signedFetch(resource, txId, AUDITOR_B_KEY, fixedNonce);
    assert.equal(first.status, 200);
    const second = await signedFetch(resource, txId, AUDITOR_B_KEY, fixedNonce);
    assert.equal(second.status, 403);
    const replay = (await second.json()) as { error: string };
    assert.match(replay.error, /nonce replay/i);

    // Revoke.
    const revoke = await fetch(`${baseUrl}/api/audit/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-operator': OPERATOR },
      body: JSON.stringify({ auditor: AUDITOR_B }),
    });
    assert.equal(revoke.status, 200);

    // Now denied — even for a fresh nonce.
    const after = await signedFetch(resource, txId, AUDITOR_B_KEY);
    assert.equal(after.status, 403);
    const afterBody = (await after.json()) as { error: string };
    assert.match(afterBody.error, /denied/i);
    const afterEvidence = await signedFetch(`/api/audit/evidence/${txId}`, txId, AUDITOR_B_KEY);
    assert.equal(afterEvidence.status, 403);

    // Public view is unaffected by revocation.
    const pub = await fetch(`${baseUrl}/api/audit/tx/${txId}`);
    assert.equal(pub.status, 200);
    assert.equal((await pub.json() as { txId?: string }).txId, txId);
  });

  it('6. attachSettlement — the on-chain settlement fact is a public-only update; commitment unchanged', async () => {
    const txId = 'tx-0006';
    recordViaVault(txId, { settlementStatus: 'locked' });
    const before = h.vault.publicView(txId)!;
    const commitmentBefore = before.commitment;

    const res = h.vault.attachSettlement(txId, {
      settlementStatus: 'settled',
      settlementTx: '0x' + 'ab'.repeat(32),
      escrowTx: '0x' + 'cd'.repeat(32),
      mandateId: '7',
    });
    assert.equal(res.ok, true);

    const after = h.vault.publicView(txId)!;
    assert.equal(after.settlementStatus, 'settled');
    assert.equal(after.settlementTx, '0x' + 'ab'.repeat(32));
    assert.equal(after.escrowTx, '0x' + 'cd'.repeat(32));
    assert.equal(after.mandateId, '7');
    // Public-only update: the commitment (binding the sealed ciphertext) must not move.
    assert.equal(after.commitment, commitmentBefore);
    assert.equal(after.encrypted, true);

    // Unknown tx is refused.
    const missing = h.vault.attachSettlement('tx-9999', { settlementStatus: 'settled' });
    assert.equal(missing.ok, false);
  });
});

function flipBase64(b64: string): string {
  const buf = Buffer.from(b64, 'base64');
  buf[0] ^= 0xff;
  return buf.toString('base64');
}