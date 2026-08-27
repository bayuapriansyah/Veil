'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from '@phosphor-icons/react';
import { Card, PageHeader, StatusChip } from '@/components/ui';
import { TransactionTimeline } from '@/components/transaction-timeline';
import { OrderDetail, SEPOLIA_EXPLORER, atomsUsd, timeAgo, txShort } from '@/lib/veil-client';
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
            <Link
              href="/app/transactions"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs text-mut transition-colors hover:text-ink"
            >
              <ArrowLeft size={14} />
              All transactions
            </Link>
          </div>
        }
      />

      {!order ? (
        <Card>
          <p className="py-10 text-center text-sm text-mut">Loading order…</p>
        </Card>
      ) : (
        <div className="grid gap-7 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <TransactionTimeline order={order} />
          </div>
          <div className="space-y-6">
            <Card title="Facts">
              <dl className="space-y-3 text-[15px]">
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
                  <dd className="font-mono text-attest">{order.escrowStatus}</dd>
                </div>
                {(order.onchainRecordTxHash || order.fulfillmentTxHash) && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-mut">On-chain</dt>
                    <dd className="flex flex-col items-end gap-1">
                      {order.onchainRecordTxHash && (
                        <a
                          href={`${SEPOLIA_EXPLORER}${order.onchainRecordTxHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[11px] text-mut underline decoration-line/60 underline-offset-2 hover:text-ok"
                        >
                          src {txShort(order.onchainRecordTxHash)} ↗
                        </a>
                      )}
                      {order.fulfillmentTxHash && (
                        <a
                          href={`${SEPOLIA_EXPLORER}${order.fulfillmentTxHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[11px] text-mut underline decoration-line/60 underline-offset-2 hover:text-ok"
                        >
                          fulfil {txShort(order.fulfillmentTxHash)} ↗
                        </a>
                      )}
                    </dd>
                  </div>
                )}
              </dl>
            </Card>
            <Card title="Evidence">
              {order.resultHash ? (
                <div className="space-y-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-mut">Fulfillment hash</div>
                    <div className="break-all font-mono text-[11px] text-attest">{order.resultHash}</div>
                    <p className="mt-1 text-[11px] text-mut/70">SHA-256 of the fulfillment data — stored in the encrypted audit vault, not on-chain.</p>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-mut">Audit trail</div>
                    <Link href="/app/audit" className="font-mono text-xs text-attest hover:underline">
                      View in Audit →
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