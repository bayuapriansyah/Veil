'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, PageHeader, StatusChip } from '@/components/ui';
import { TransactionTimeline } from '@/components/transaction-timeline';
import { OrderDetail, atomsUsd, timeAgo } from '@/lib/veil-client';
import { usePoll } from '@/lib/use-poll';

export default function TransactionDetailPage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const { data } = usePoll<{ ok: boolean; orders: OrderDetail[] }>('/api/veil/orders', { ok: true, orders: [] }, 2000);
  const order = (data.orders ?? []).find((o) => o.orderId === params.id);

  return (
    <div>
      <PageHeader
        title={`Order ${params.id}`}
        sub="Full state machine of this purchase, driven by the real ledger, audit vault and x402 rail."
        right={
          <div className="flex items-center gap-3">
            {order && <StatusChip status={order.ok ? 'SETTLED' : 'REJECTED'} label={order.ok ? 'SETTLED' : 'REFUSED'} />}
            <Link href="/app/transactions" className="text-xs text-attest hover:underline">
              ← all transactions
            </Link>
          </div>
        }
      />

      {!order ? (
        <Card>
          <p className="py-10 text-center text-sm text-mut">Loading order…</p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <TransactionTimeline order={order} />
          </div>
          <div className="space-y-6">
            <Card title="Facts">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-mut">Service</dt>
                  <dd className="text-ink">{order.serviceLabel}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-mut">Amount</dt>
                  <dd className="font-mono text-ink">{atomsUsd(order.amountAtoms)} USD</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-mut">Atoms</dt>
                  <dd className="font-mono text-mut">{order.amountAtoms}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-mut">Provider</dt>
                  <dd className="font-mono text-mut">{order.provider.slice(0, 14)}…</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-mut">Created</dt>
                  <dd className="text-mut">{timeAgo(Math.floor(order.createdAt / 1000))}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-mut">Escrow</dt>
                  <dd className="font-mono text-cyan-300">{order.escrowStatus}</dd>
                </div>
              </dl>
            </Card>
            <Card title="Evidence">
              {order.resultHash ? (
                <div className="space-y-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-mut">Result hash</div>
                    <div className="break-all font-mono text-[11px] text-attest">{order.resultHash}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-mut">Sealed in vault</div>
                    <Link href="/app/audit" className="font-mono text-xs text-attest hover:underline">
                      /api/veil/audit
                    </Link>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-mut">{order.error ?? 'No evidence. Purchase refused.'}</p>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}