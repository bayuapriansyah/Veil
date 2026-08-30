'use client';

import { useState, useEffect } from 'react';
import { OrderDetail, SEPOLIA_EXPLORER, CC3_EXPLORER, atomsUsd, txShort } from '../lib/veil-client';
import { Card, StatusChip } from './ui';

function stageExplorerLink(stKey: string, order: OrderDetail): string | null {
  switch (stKey) {
    case 'payment':
      return order.onchainRecordTxHash ? `${SEPOLIA_EXPLORER}${order.onchainRecordTxHash}` : null;
    case 'fulfillment':
      return order.fulfillmentTxHash ? `${SEPOLIA_EXPLORER}${order.fulfillmentTxHash}` : null;
    case 'zk-receipt':
      return order.zkTxHash ? `${SEPOLIA_EXPLORER}${order.zkTxHash}` : null;
    default:
      return null;
  }
}

const ATTESTATION_WINDOW_MS = 6 * 60 * 1000;

function AttestationProgress({ order }: { order: OrderDetail }): React.ReactElement {
  const total = order.stages.length;
  const done = order.stages.filter((s) => s.status === 'VERIFIED' || s.status === 'SETTLED').length;
  const pct = total > 0 ? (done / total) * 100 : 0;

  const createdAt = order.createdAt;
  const elapsed = Date.now() - createdAt;
  const remaining = Math.max(0, ATTESTATION_WINDOW_MS - elapsed);
  const allDone = done >= total || remaining === 0;

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (allDone) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [allDone]);

  const rem = Math.max(0, ATTESTATION_WINDOW_MS - (now - createdAt));
  const remMin = Math.floor(rem / 60_000);
  const remSec = Math.floor((rem % 60_000) / 1000);

  const activeStage = order.stages.find((s) => s.status === 'PENDING');

  const barColor = pct >= 100 ? 'bg-ok' : pct >= 60 ? 'bg-attest' : pct >= 30 ? 'bg-pend' : 'bg-ok/60';

  return (
    <div className="mb-5 rounded-lg border border-line bg-panel2/50 p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-medium text-ink">Pipeline Progress</span>
          <span className="font-mono text-[12px] text-mut">{done}/{total} stages</span>
        </div>
        {!allDone && (
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-attest opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-attest" />
            </span>
            <span className="font-mono text-[12px] text-attest">
              {remMin}m {remSec.toString().padStart(2, '0')}s remaining
            </span>
          </div>
        )}
        {allDone && (
          <span className="font-mono text-[12px] text-ok">complete</span>
        )}
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-panel">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px] text-mut">
        <span>
          {allDone
            ? 'All stages verified — same ~6min attestation window as every order on the protocol'
            : activeStage
              ? `Waiting: ${activeStage.label} — CC3 block attestation (~6 min)`
              : 'Processing…'
          }
        </span>
        <span className="font-mono">{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

/**
 * Authorization -> Payment -> Payment Attestation -> Fulfillment ->
 * Fulfillment Attestation -> ZK Receipt -> ZK Attestation -> Settlement.
 * States are the REAL ledger states: nothing is animated that the rail has not
 * actually done.
 */
export function TransactionTimeline({ order }: { order: OrderDetail }): React.ReactElement {
  return (
    <Card title={`Timeline · ${order.orderId}`}>
      <AttestationProgress order={order} />
      <ol className="relative space-y-0">
        {order.stages.map((st, i) => {
          const done = st.status === 'VERIFIED' || st.status === 'SETTLED';
          const bad = st.status === 'FAILED' || st.status === 'REJECTED';
          const last = i === order.stages.length - 1;
          const explorerHref = stageExplorerLink(st.key, order);
          const isAttestation = st.key.includes('attestation');
          return (
            <li key={st.key} className="relative flex gap-5 pb-7 last:pb-0">
              {!last && (
                <span
                  className={`absolute left-[11px] top-[26px] h-[calc(100%-22px)] w-px ${
                    done ? 'bg-ok/50' : 'bg-line/60'
                  }`}
                />
              )}
              <span
                className={`relative mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                  done
                    ? 'border-ok bg-ok/15 text-ok'
                    : bad
                      ? 'border-bad bg-bad/15 text-bad'
                      : isAttestation
                        ? 'border-attest/50 bg-attest/10 text-attest animate-pulse'
                        : 'border-line bg-panel2 text-mut'
                }`}
              >
                {done ? '✓' : bad ? '✕' : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className={`text-[15px] font-medium ${bad ? 'text-bad' : 'text-ink'}`}>{st.label}</span>
                  <StatusChip status={st.status} />
                  {st.key === 'payment' && (
                    <span className="font-mono text-[13px] text-mut">{atomsUsd(order.amountAtoms)} USD</span>
                  )}
                  {st.key === 'fulfillment' && order.resultHash && (
                    <span className="truncate font-mono text-xs text-mut">hash {order.resultHash.slice(0, 18)}…</span>
                  )}
                  {st.key === 'zk-receipt' && order.zkProofHash && (
                    <span className="truncate font-mono text-xs text-attest" title={order.zkProofHash}>
                      zk {order.zkProofHash.slice(0, 18)}…
                    </span>
                  )}
                  {st.key === 'zk-attestation' && order.zkProofHash && (
                    <span className="font-mono text-[11px] text-mut">~6 min window · same cost for all</span>
                  )}
                </div>
                {st.note && <p className="mt-1.5 text-sm leading-relaxed text-mut">{st.note}</p>}
                {explorerHref && (
                  <a
                    href={explorerHref}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 inline-block font-mono text-[11px] text-mut underline decoration-line/60 underline-offset-2 hover:text-ok"
                  >
                    ↳ {txShort(explorerHref.split('/tx/')[1])} (Sepolia) ↗
                  </a>
                )}
                {order.error && (st.status === 'REJECTED' || st.status === 'FAILED') && (
                  <p className="mt-2 rounded-lg border border-bad/25 bg-bad/10 px-3 py-2 font-mono text-[13px] text-bad">
                    {order.error}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
