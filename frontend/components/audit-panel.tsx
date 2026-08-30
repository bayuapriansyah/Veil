'use client';

import { useEffect, useState } from 'react';
import { AuditTx, AuditorView, api, shortAddress, timeAgo, txShort } from '../lib/veil-client';
import { generateAuditPDF } from '../lib/audit-pdf';
import { Card, Empty, StatusChip } from './ui';

interface AuditEnvelope {
  ok: boolean;
  txCount: number;
  txs: AuditTx[];
  auditors: AuditorView[];
}

export function AuditConsole(): React.ReactElement {
  const [txs, setTxs] = useState<AuditTx[]>([]);
  const [auditors, setAuditors] = useState<AuditorView[]>([]);
  const [selected, setSelected] = useState('');
  const [fields, setFields] = useState('');
  const [disclosure, setDisclosure] = useState<{ ok: boolean; data?: unknown; error?: string } | null>(null);
  const [goodAttempt, setGoodAttempt] = useState<{ ok: boolean; error?: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [newAuditor, setNewAuditor] = useState('0x' + 'aa'.repeat(20));
  const [notice, setNotice] = useState('');

  const refresh = async (): Promise<void> => {
    try {
      const env = await api<AuditEnvelope>('/api/veil/audit');
      setTxs(env.txs);
      setAuditors(env.auditors);
      setNotice('');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  // load once + every 4s so the register stays live
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 4000);
    return () => clearInterval(id);
  }, []);

  const runDisclose = async (): Promise<void> => {
    if (!selected) return;
    const f = fields.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      const res = await api<{ ok: boolean; data?: unknown; error?: string }>('/api/veil/audit/disclose', {
        method: 'POST',
        body: JSON.stringify({ txId: selected, fields: f.length ? f : undefined }),
      });
      setDisclosure(res);
    } catch (e) {
      setDisclosure({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const runUnauthorized = async (): Promise<void> => {
    if (!selected) return;
    try {
      const res = await api<{ ok: boolean; error?: string }>('/api/veil/audit/attempt', {
        method: 'POST',
        body: JSON.stringify({ txId: selected }),
      });
      setGoodAttempt(res);
    } catch (e) {
      setGoodAttempt({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const setScope = async (auditor: string, authorize: boolean): Promise<void> => {
    await api(authorize ? '/api/veil/audit/authorize' : '/api/veil/audit/revoke', {
      method: 'POST',
      body: JSON.stringify({ auditor }),
    });
    await refresh();
  };

  const handleExportPDF = async (): Promise<void> => {
    if (txs.length === 0) return;
    setExporting(true);
    try {
      await generateAuditPDF(txs);
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card
        title="Audit Register (public view)"
        right={
          <div className="flex items-center gap-3">
            <StatusChip status="VERIFIED" label={`${txs.length} sealed txs`} />
            {txs.length > 0 && (
              <button
                onClick={() => void handleExportPDF()}
                disabled={exporting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs text-mut transition-colors hover:text-ink disabled:opacity-50"
              >
                {exporting ? (
                  <>
                    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Exporting…
                  </>
                ) : (
                  <>
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <polyline points="14,2 14,8 20,8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10,9 9,9 8,9" />
                    </svg>
                    Export PDF
                  </>
                )}
              </button>
            )}
          </div>
        }
      >
        {notice && <p className="mb-3 text-xs text-bad">{notice}</p>}
        {txs.length === 0 ? (
          <Empty message="No sealed transactions yet. Run a purchase and it lands here immediately." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[15px]">
              <thead>
                <tr className="border-b border-line font-mono text-[11px] font-medium uppercase tracking-wider text-mut/80">
                  <th className="pb-3 pr-5">TxId</th>
                  <th className="pb-3 pr-5">Commitment</th>
                  <th className="pb-3 pr-5">Verification</th>
                  <th className="pb-3 pr-5">Policy</th>
                  <th className="pb-3 pr-5">Settlement</th>
                  <th className="pb-3 pr-5">ZK Proof</th>
                  <th className="pb-3 pr-5">Attestation</th>
                  <th className="pb-3">When</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.txId} className="border-b border-line/60 last:border-0 hover:bg-panel2/60">
                    <td className="py-3.5 pr-5">
                      <button
                        className="font-mono text-[13px] text-ok hover:underline"
                        onClick={() => setSelected(t.txId)}
                      >
                        {txShort(t.txId)}
                      </button>
                    </td>
                    <td className="py-3.5 pr-5 font-mono text-xs text-mut">{t.commitment.slice(0, 16)}…</td>
                    <td className="py-3.5 pr-5 font-mono text-[13px] text-ok">{t.verificationStatus}</td>
                    <td className="py-3.5 pr-5 font-mono text-[13px] text-mut">{t.policyStatus}</td>
                    <td className="py-3.5 pr-5">
                      <div className="flex flex-col gap-1">
                        <span className={`font-mono text-[13px] ${t.settlementStatus === 'settled' ? 'text-ok' : 'text-mut'}`}>
                          {t.settlementStatus}
                        </span>
                        {t.settlementTx && (
                          <a
                            className="font-mono text-[11px] text-ok underline decoration-ok/40 underline-offset-2 hover:text-ok"
                            href={`https://creditcoin-testnet.blockscout.com/tx/${t.settlementTx}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            settle {txShort(t.settlementTx)}
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 pr-5">
                      <div className="flex flex-col gap-1">
                        {t.zkProofHash ? (
                          <>
                            <span className={`font-mono text-[13px] ${t.zkReceiptStatus === 'verified' ? 'text-ok' : t.zkReceiptStatus === 'proving' ? 'text-amber-400' : 'text-mut'}`}>
                              {t.zkReceiptStatus === 'verified' ? 'ZK VERIFIED' : t.zkReceiptStatus === 'proving' ? 'ZK PROVING' : 'ZK PENDING'}
                            </span>
                            <span className="font-mono text-[10px] text-mut/60" title={t.zkProofHash}>
                              {t.zkProofHash.slice(0, 10)}...
                            </span>
                          </>
                        ) : (
                          <span className="font-mono text-[13px] text-mut/40">—</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 pr-5">
                      <div className="flex flex-col gap-1">
                        <StatusChip
                          status={t.attestationStatus === 'verified' ? 'VERIFIED' : t.attestationStatus === 'proving' || t.attestationStatus === 'a2a-delegation' ? 'PENDING' : 'REJECTED'}
                          label={t.attestationStatus === 'verified' ? 'VERIFIED' : t.attestationStatus === 'proving' ? 'PROVING' : t.attestationStatus === 'a2a-delegation' ? 'A2A DELEGATION' : 'MIRROR'}
                        />
                        {t.sourceTx ? (
                          <a
                            className="font-mono text-[11px] text-mut underline decoration-line/60 underline-offset-2 hover:text-ok"
                            href={`https://sepolia.etherscan.io/tx/${t.sourceTx}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            src {txShort(t.sourceTx)}
                          </a>
                        ) : (
                          <span className="font-mono text-[11px] text-mut/50 italic">not recorded</span>
                        )}
                        {t.attestationTx ? (
                          <a
                            className="font-mono text-[11px] text-ok underline decoration-ok/40 underline-offset-2 hover:text-ok"
                            href={`https://creditcoin-testnet.blockscout.com/tx/${t.attestationTx}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            cc3 {txShort(t.attestationTx)}
                          </a>
                        ) : (
                          <span className="font-mono text-[11px] text-mut/50 italic">pending proof</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 text-[13px] text-mut/80">{timeAgo(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-wider text-mut">Selected transaction</div>
            <select className="input-dark" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">select a txId</option>
              {txs.map((t) => (
                <option key={t.txId} value={t.txId}>
                  {txShort(t.txId)}
                </option>
              ))}
            </select>
            <div className="text-xs font-medium uppercase tracking-wider text-mut">
              Fields (comma separated, blank = full bundle)
            </div>
            <input
              className="input-dark"
              placeholder="agent, amountAtoms, paymentEvidence, settlementEvidence…"
              value={fields}
              onChange={(e) => setFields(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={() => void runDisclose()} disabled={!selected}>
                Disclose (signed auditor)
              </button>
              <button className="btn-muted" onClick={() => void runUnauthorized()} disabled={!selected}>
                Attempt as unauthorized
              </button>
            </div>
          </div>
          <div className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-wider text-mut">Result</div>
            {!disclosure && !goodAttempt && (
              <p className="text-sm text-mut">
                The vault reveals <span className="text-ink">only requested fields</span> to an auditor whose
                EIP-712 AuditAccess recovers to an authorized address with an unused nonce.
              </p>
            )}
            {disclosure && (
              <pre className="max-h-60 overflow-auto rounded-lg border border-line bg-panel2 p-4 font-mono text-[12px] leading-relaxed text-ok">
                {JSON.stringify(disclosure.data ?? { error: disclosure.error }, null, 2)}
              </pre>
            )}
            {goodAttempt && (
              <pre
                className={`rounded-lg border p-3.5 font-mono text-[12px] ${
                  goodAttempt.ok ? 'border-ok/40 text-ok' : 'border-bad/30 text-bad'
                }`}
              >
                {goodAttempt.ok ? 'unexpectedly opened' : `REFUSED: ${goodAttempt.error}`}
              </pre>
            )}
          </div>
        </div>
      </Card>

      <Card title="Auditor Registry" right={<span className="font-mono text-[11px] text-mut">vault decides · ECRECOVER not header</span>}>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <div className="text-[11px] uppercase tracking-wider text-mut">authorize an auditor address</div>
            <input className="input-dark mt-1" value={newAuditor} onChange={(e) => setNewAuditor(e.target.value)} />
          </div>
          <button className="btn-primary" onClick={() => void setScope(newAuditor, true)}>
            Authorize
          </button>
        </div>
        {auditors.length === 0 ? (
          <Empty message="No auditors registered yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[15px]">
              <thead>
                <tr className="border-b border-line font-mono text-[11px] font-medium uppercase tracking-wider text-mut/80">
                  <th className="pb-3 pr-5">Auditor</th>
                  <th className="pb-3 pr-5">Auth</th>
                  <th className="pb-3 pr-5">Scope</th>
                  <th className="pb-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {auditors.map((a) => (
                  <tr key={a.auditor} className="border-b border-line/60 last:border-0 hover:bg-panel2/60">
                    <td className="py-3.5 pr-5 font-mono text-[13px] text-ink">{shortAddress(a.auditor, 6)}</td>
                    <td className="py-3.5 pr-5">
                      <StatusChip status={a.authorized ? 'VERIFIED' : 'REJECTED'} label={a.authorized ? 'AUTHORIZED' : 'REVOKED'} />
                    </td>
                    <td className="py-3.5 pr-5 font-mono text-[13px] text-mut">{a.revokedAt ? `revoked ${timeAgo(a.revokedAt)}` : 'all'}</td>
                    <td className="py-3.5">
                      <button
                        className="text-[13px] text-ok hover:underline disabled:opacity-40"
                        disabled={a.authorized}
                        onClick={() => void setScope(a.auditor, true)}
                      >
                        re-authorize
                      </button>
                      <span className="mx-2 text-line">·</span>
                      <button
                        className="text-[13px] text-bad hover:underline disabled:opacity-40"
                        disabled={!a.authorized}
                        onClick={() => void setScope(a.auditor, false)}
                      >
                        revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-5 rounded-lg border border-line bg-panel2/70 p-4 text-sm leading-relaxed text-mut">
          Boundary: the register seals amounts, agents and evidence with AES-256-GCM. Attestcoin verifies cross-chain
          facts. It does not grant privacy. Disclosure opens only to signed, authorized, in-scope auditors with an
          unused nonce. The <span className="text-ink">Attestation</span> column is public chain data (Sepolia source tx
          + Creditcoin proof tx) — the facts are public; the business context stays sealed.
        </p>
      </Card>
    </div>
  );
}