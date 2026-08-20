'use client';

import { OrderDetail, VeilState, atomsUsd } from '@/lib/veil-client';
import { usePoll } from '@/lib/use-poll';
import { BudgetGauge } from '@/components/flow-control';
import { OrdersTable } from '@/components/orders-table';
import { Card, PageHeader, Stat, StatusChip, Address } from '@/components/ui';

const EMPTY_STATE: VeilState = {
  agent: { address: '', status: 'active' },
  killSwitch: false,
  budgetAtoms: '0',
  spentAtoms: '0',
  remainingAtoms: '0',
  reservedAtoms: '0',
  reputation: { provider: '', score: 0, reviews: 0 },
  verifiedTransactions: 0,
  transactionCount: 0,
  currentMandate: null,
  providersCount: 0,
  orderIds: [],
  keySource: '',
  txsAtoms: '0',
  mode: 'demo',
};

export default function DashboardPage(): React.ReactElement {
  const { data } = usePoll<{ ok: boolean; state: VeilState }>('/api/veil/state', { ok: true, state: EMPTY_STATE });
  const { data: ordersData } = usePoll<{ ok: boolean; orders: OrderDetail[] }>('/api/veil/orders', { ok: true, orders: [] });
  const s = data.state ?? EMPTY_STATE;
  const orders = ordersData.orders ?? [];

  return (
    <div>
      <PageHeader
        title="Operations Dashboard"
        sub="VEIL = Verifiable Economic Infrastructure Ledger. Everything below is live state from the rail: the demo settlement ledger, the x402 purchase path and the sealed audit vault."
        right={
          <StatusChip status={s.killSwitch ? 'REJECTED' : 'VERIFIED'} label={s.killSwitch ? 'KILL SWITCHED' : 'OPERATIONAL'} />
        }
      />

      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <Stat
          label="Agent"
          value={s.agent.status.toUpperCase()}
          tone={s.killSwitch ? 'bad' : 'ok'}
          sub={s.agent.address ? <Address addr={s.agent.address} /> : undefined}
        />
        <Stat
          label="Budget remaining"
          value={atomsUsd(s.remainingAtoms)}
          sub={`${atomsUsd(s.spentAtoms)} of ${atomsUsd(s.budgetAtoms)} spent`}
        />
        <Stat
          label="Verified transactions"
          value={s.verifiedTransactions}
          tone="ok"
          sub={`${s.transactionCount} attempted`}
        />
        <Stat
          label="Provider reputation"
          value={s.reputation.score > 0 ? s.reputation.score : 'N/A'}
          tone={s.reputation.score >= 3 ? 'ok' : 'pend'}
          sub={`${s.providersCount} providers registered`}
        />
      </div>

      <div className="mt-8 grid gap-7 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card title="Mandate spend" right={<StatusChip status="VERIFIED" label="ACTIVE MANDATE" />}>
            {s.currentMandate ? (
              <div className="space-y-5">
                <BudgetGauge budgetAtoms={s.currentMandate.budgetAtoms} spentAtoms={s.currentMandate.spentAtoms} />
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-mut">Mandate</div>
                    <div className="font-mono text-ink">#{s.currentMandate.mandateId}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-mut">Service</div>
                    <div className="text-ink">{s.currentMandate.serviceLabel}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-mut">Owner</div>
                    <div className="font-mono text-mut">{s.currentMandate.owner.slice(0, 12)}…</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-mut">Reserved in escrow</div>
                    <div className="font-mono text-pend">{atomsUsd(s.reservedAtoms)} USD</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-mut">Vault key</div>
                    <div className="font-mono text-attest">{s.keySource || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-mut">Every purchase</div>
                    <div className="text-ink">sealed into /audit</div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-mut">No active mandate.</p>
            )}
          </Card>

          <Card
            title="Recent transactions"
            right={<a className="text-sm font-medium text-ok hover:underline" href="/app/transactions">all →</a>}
          >
            <OrdersTable orders={orders.slice(0, 5)} />
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card title="Live rails">
            <ul className="space-y-4 text-[15px]">
              <li className="flex justify-between gap-2">
                <span className="text-mut">Purchase rail</span>
                <span className="font-mono text-ok">x402 · veil-exact · Sepolia record</span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-mut">Settlement</span>
                <span className="font-mono text-mut">SettlementEngine (mirror · no USDC)</span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-mut">Attestation</span>
                <span className="font-mono text-ok">Attestcoin · live ASC (CC3)</span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-mut">Audit at rest</span>
                <span className="font-mono text-ok">AES-256-GCM sealed</span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-mut">Privacy boundary</span>
                <span className="font-mono text-mut">Attestcoin ≠ privacy</span>
              </li>
            </ul>
            <p className="mt-5 border-t border-line pt-5 text-sm leading-relaxed text-mut">
              Purchases run from the Agent cockpit. Every settled order lands in the Transactions list and is sealed
              into the audit register, then visualized on the Agent Economy canvas.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}