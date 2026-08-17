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
            <li key={st.key} className="relative flex gap-4 pb-6 last:pb-0">
              {!last && (
                <span
                  className={`absolute left-[9px] top-[22px] h-[calc(100%-18px)] w-px ${
                    done ? 'bg-line' : 'bg-line/40'
                  }`}
                />
              )}
              <span
                className={`relative mt-1 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border text-[9px] ${
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
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm font-medium ${bad ? 'text-bad' : 'text-ink'}`}>{st.label}</span>
                  <StatusChip status={st.status} />
                  {st.key === 'payment' && (
                    <span className="font-mono text-xs text-mut">{atomsUsd(order.amountAtoms)} USD</span>
                  )}
                  {st.key === 'fulfillment' && order.resultHash && (
                    <span className="truncate font-mono text-[11px] text-mut">hash {order.resultHash.slice(0, 18)}…</span>
                  )}
                </div>
                {st.note && <p className="mt-1 text-xs leading-relaxed text-mut">{st.note}</p>}
                {order.error && (st.status === 'REJECTED' || st.status === 'FAILED') && (
                  <p className="mt-1 rounded-md border border-bad/30 bg-bad/10 px-2 py-1 font-mono text-xs text-bad">
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