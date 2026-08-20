'use client';

import { OrderDetail, atomsUsd } from '../lib/veil-client';
import { Card, StatusChip } from './ui';

/**
 * Authorization -> Payment -> PaymentAttestation -> Fulfillment ->
 * FulfillmentAttestation -> Settlement. States are the REAL ledger states:
 * nothing is animated that the rail has not actually done.
 */
export function TransactionTimeline({ order }: { order: OrderDetail }): React.ReactElement {
  return (
    <Card title={`Timeline · ${order.orderId}`}>
      <ol className="relative space-y-0">
        {order.stages.map((st, i) => {
          const done = st.status === 'VERIFIED' || st.status === 'SETTLED';
          const bad = st.status === 'FAILED' || st.status === 'REJECTED';
          const last = i === order.stages.length - 1;
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
                </div>
                {st.note && <p className="mt-1.5 text-sm leading-relaxed text-mut">{st.note}</p>}
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