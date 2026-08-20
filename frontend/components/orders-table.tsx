'use client';

import Link from 'next/link';
import { OrderDetail, atomsUsd, timeAgo } from '../lib/veil-client';
import { Empty, StatusChip, TxId } from './ui';

function overall(order: OrderDetail): OrderDetail['stages'][number]['status'] {
  if (order.stages.length === 0) return 'PENDING';
  return order.stages[order.stages.length - 1].status;
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
            <th className="pb-3 pr-5">Settlement</th>
            <th className="pb-3">When</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.orderId} className="group border-b border-line/60 last:border-0 hover:bg-panel2/60">
              <td className="py-3.5 pr-5">
                <Link
                  href={`/app/transactions/${o.orderId}`}
                  className="text-ok transition-colors hover:underline"
                >
                  <TxId id={o.orderId} />
                </Link>
              </td>
              <td className="py-3.5 pr-5 text-mut">{o.serviceLabel}</td>
              <td className="py-3.5 pr-5">
                <span className="font-mono text-[13px] text-mut">{o.provider.slice(0, 10)}…</span>
              </td>
              <td className="py-3.5 pr-5 text-right font-mono text-[13px] text-mut">{atomsUsd(o.amountAtoms)} USD</td>
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