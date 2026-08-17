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
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line font-mono text-[11px] uppercase tracking-wider text-mut">
            <th className="pb-2 pr-4">Order</th>
            <th className="pb-2 pr-4">Service</th>
            <th className="pb-2 pr-4">Provider</th>
            <th className="pb-2 pr-4 text-right">Amount</th>
            <th className="pb-2 pr-4">Settlement</th>
            <th className="pb-2">When</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.orderId} className="border-b border-line/40 last:border-0 hover:bg-panel2/40">
              <td className="py-2.5 pr-4">
                <Link href={`/app/transactions/${o.orderId}`} className="text-attest hover:underline">
                  <TxId id={o.orderId} />
                </Link>
              </td>
              <td className="py-2.5 pr-4 text-mut">{o.serviceLabel}</td>
              <td className="py-2.5 pr-4">
                <span className="font-mono text-xs text-mut">{o.provider.slice(0, 10)}…</span>
              </td>
              <td className="py-2.5 pr-4 text-right font-mono text-mut">{atomsUsd(o.amountAtoms)} USD</td>
              <td className="py-2.5 pr-4">
                <StatusChip status={overall(o)} />
              </td>
              <td className="py-2.5 text-xs text-mut">{timeAgo(Math.floor(o.createdAt / 1000))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}