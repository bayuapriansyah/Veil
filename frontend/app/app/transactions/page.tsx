'use client';

import { Card, PageHeader } from '@/components/ui';
import { OrdersTable } from '@/components/orders-table';
import { OrderDetail } from '@/lib/veil-client';
import { usePoll } from '@/lib/use-poll';

export default function TransactionsPage(): React.ReactElement {
  const { data } = usePoll<{ ok: boolean; orders: OrderDetail[] }>('/api/veil/orders', { ok: true, orders: [] });
  const orders = data.orders ?? [];

  return (
    <div>
      <PageHeader
        title="Transactions"
        sub="Every order that ran the full rail: authorization → payment → attestation → fulfillment → attestation → settlement. Settlement happens the moment the operator releases escrow after both verifications."
        right={<span className="rounded-full border border-line bg-panel px-3.5 py-1.5 font-mono text-[11px] text-mut">{orders.length} orders</span>}
      />
      <Card>
        <OrdersTable orders={orders} />
        <p className="mt-4 text-xs text-mut">
          Click an order to open its full state machine. Each stage shows the real ledger state, nothing animated that
          did not happen.
        </p>
      </Card>
    </div>
  );
}