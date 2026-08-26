'use client';

import { Card, PageHeader } from '@/components/ui';
import { EconomyCanvas } from '@/components/economy-canvas';
import { OrderDetail, STAGE_NODE_INDEX, CANVAS_NODES, useVeilMode } from '@/lib/veil-client';
import { usePoll } from '@/lib/use-poll';

export default function CanvasPage(): React.ReactElement {
  const { data } = usePoll<{ ok: boolean; orders: OrderDetail[] }>('/api/veil/orders', { ok: true, orders: [] }, 1500);
  const orders = data.orders ?? [];
  const mode = useVeilMode();

  return (
    <div>
      <PageHeader
        title="Agent Economy"
        sub="The full VEIL pipeline in motion. Packets travel USER → AI AGENT → PROVIDER → PAYMENT → SOURCE CHAIN → ATTESTCOIN → CREDITCOIN → SETTLEMENT using each order's real stage state."
      />

      <EconomyCanvas orders={orders} />

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <Card title="How the visualization stays honest">
          <p className="text-[15px] leading-relaxed text-mut">
            Each pulse rides the <span className="font-mono text-ink">verified-stages</span> of the underlying order.
            A packet parks at{' '}
            <span className="font-mono text-ink">Authorization</span> if the mandate was refused, lights the path only
            as far as{' '}
            <span className="font-mono text-ink">Settlement</span> when escrow was released by the operator, and never
            glows a stage the rail has not actually reached.
          </p>
        </Card>
        <Card title="Pipeline key">
          <ul className="space-y-2 text-[15px]">
            {CANVAS_NODES.map((n, i) => {
              const stage = Object.entries(STAGE_NODE_INDEX).find(([, v]) => v === i)?.[0];
              return (
                <li key={n} className="flex justify-between">
                  <span className="font-mono text-[13px] text-ink">{i + 1} · {n}</span>
                  <span className="text-sm text-mut">{stage ? `verified by: ${stage}` : 'terminal node'}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="mt-5">
        <Card title="Disclaimer">
          <p className="text-sm leading-relaxed text-mut">
            {mode === 'production' ? (
              <>
                In production mode the raw <span className="font-mono text-ink">attestation</span> step is executed for
                real: source-chain events on Sepolia are proven via Attestcoin and verified by the
                AttestationReceiver on Creditcoin CC3, and settlement runs through the on-chain SettlementEngine.
                The UI only shows a stage as verified once the proof has actually landed.
              </>
            ) : (
              <>
                The raw <span className="font-mono text-ink">attestation</span> step (AttestationReceiver / ASC) is
                mirrored in the demo SettlementLedger. No live cross-chain attestation or ASC submission is performed
                or claimed in this demo; the UI never presents a mirrored event as a real on-chain event.
              </>
            )}
          </p>
        </Card>
      </div>
    </div>
  );
}