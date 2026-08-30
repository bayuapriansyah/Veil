'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { OrderDetail, SEPOLIA_EXPLORER, atomsUsd, timeAgo, txShort } from '../lib/veil-client';
import { Empty, StatusChip, TxId } from './ui';

const ATTESTATION_WINDOW_MS = 6 * 60 * 1000;

function overall(order: OrderDetail): OrderDetail['stages'][number]['status'] {
  if (order.stages.length === 0) return 'PENDING';
  return order.stages[order.stages.length - 1].status;
}

function ProgressMini({ order }: { order: OrderDetail }): React.ReactElement {
  const total = order.stages.length;
  const done = order.stages.filter((s) => s.status === 'VERIFIED' || s.status === 'SETTLED').length;
  const pct = total > 0 ? (done / total) * 100 : 0;
  const allDone = pct >= 100;

  const elapsed = Date.now() - order.createdAt;
  const rem = Math.max(0, ATTESTATION_WINDOW_MS - elapsed);
  const remMin = Math.floor(rem / 60_000);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (allDone || rem <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [allDone, rem]);

  const liveRem = Math.max(0, ATTESTATION_WINDOW_MS - (now - order.createdAt));
  const liveMin = Math.floor(liveRem / 60_000);

  const barColor = pct >= 100 ? 'bg-ok' : pct >= 60 ? 'bg-attest' : pct >= 30 ? 'bg-pend' : 'bg-ok/60';

  return (
    <div className="flex flex-col gap-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-panel2" style={{ width: 80 }}>
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      {!allDone && liveRem > 0 && (
        <span className="font-mono text-[10px] text-attest/80">
          ≈{liveMin}m left
        </span>
      )}
    </div>
  );
}

function ExplorerLink({ href, label }: { href: string; label: string }): React.ReactElement {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-[10px] text-mut underline decoration-line/60 underline-offset-2 hover:text-ok"
    >
      {label} ↗
    </a>
  );
}

export function OrdersTable({ orders }: { orders: OrderDetail[] }): React.ReactElement {
  if (orders.length === 0) return <Empty message="No transactions yet. Send the agent a purchase from the Agent cockpit." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-[15px]">
        <thead>
          <tr className="border-b border-line font-mono text-[11px] font-medium uppercase tracking-wider text-mut/80">
            <th className="pb-3 pr-5">Order</th>
            <th className="pb-3 pr-5">Service</th>
            <th className="pb-3 pr-5">Provider</th>
            <th className="pb-3 pr-5 text-right">Amount</th>
            <th className="pb-3 pr-5">Pipeline</th>
            <th className="pb-3 pr-5">Settlement</th>
            <th className="pb-3">When</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.orderId} className="group border-b border-line/60 last:border-0 hover:bg-panel2/60">
              <td className="py-3.5 pr-5">
                <div className="flex flex-col gap-1">
                  <Link
                    href={`/app/transactions/${o.orderId}`}
                    className="text-ok transition-colors hover:underline"
                  >
                    <TxId id={o.orderId} />
                  </Link>
                  {(o.onchainRecordTxHash || o.fulfillmentTxHash) && (
                    <div className="flex flex-col gap-0.5">
                      {o.onchainRecordTxHash && (
                        <ExplorerLink href={`${SEPOLIA_EXPLORER}${o.onchainRecordTxHash}`} label={`src ${txShort(o.onchainRecordTxHash)}`} />
                      )}
                      {o.fulfillmentTxHash && (
                        <ExplorerLink href={`${SEPOLIA_EXPLORER}${o.fulfillmentTxHash}`} label={`fulfil ${txShort(o.fulfillmentTxHash)}`} />
                      )}
                    </div>
                  )}
                </div>
              </td>
              <td className="py-3.5 pr-5 text-mut">{o.serviceLabel}</td>
              <td className="py-3.5 pr-5">
                <span className="font-mono text-[13px] text-mut">{o.provider.slice(0, 10)}…</span>
              </td>
              <td className="py-3.5 pr-5 text-right font-mono text-[13px] text-mut">{atomsUsd(o.amountAtoms)} USD</td>
              <td className="py-3.5 pr-5">
                <ProgressMini order={o} />
              </td>
              <td className="py-3.5 pr-5">
                <StatusChip status={overall(o)} />
              </td>
              <td className="py-3.5 text-[13px] text-mut/80">{timeAgo(Math.floor(o.createdAt / 1000))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}