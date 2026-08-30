'use client';

import { Card, PageHeader, StatusChip, Address } from '@/components/ui';
import { KillSwitch, PurchaseConsole } from '@/components/flow-control';
import { OrderDetail, VeilState, atomsUsd } from '@/lib/veil-client';
import { usePoll } from '@/lib/use-poll';

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

const TOOLS = [
  ['searchProviders', 'discovery · reputation ≥ 3 only'],
  ['getProviderDetails', 'profile read'],
  ['checkProviderSecurity', 'bytecode safety scan · risk 0–100'],
  ['checkMandate', 'mandate coverage read'],
  ['checkBudget', 'remaining-budget read'],
  ['checkReputation', 'ledger score read'],
  ['requestService', 'reserve an offer (gates mandate + budget)'],
  ['makePayment', 'the ONLY payment path'],
] as const;

export default function AgentPage(): React.ReactElement {
  const { data } = usePoll<{ ok: boolean; state: VeilState }>('/api/veil/state', { ok: true, state: EMPTY_STATE });
  const { data: orders } = usePoll<{ ok: boolean; orders: OrderDetail[] }>('/api/veil/orders', { ok: true, orders: [] });
  const s = data.state ?? EMPTY_STATE;

  return (
    <div>
      <PageHeader
        title="Agent Cockpit"
        sub="Direct the procurement agent. It plans with an 8-tool surface and the SettlementLedger stays the authority on what may be paid. The agent holds no privileged tools."
        right={
          <StatusChip
            status={s.agent.status === 'active' ? 'VERIFIED' : 'REJECTED'}
            label={s.agent.status === 'active' ? 'AGENT ACTIVE' : 'AGENT KILLED'}
          />
        }
      />

      <div className="grid gap-7 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <PurchaseConsole />
          <Card title="Answered so far">
            {orders.orders.length === 0 ? (
              <p className="text-sm text-mut">No runs yet.</p>
            ) : (
              <ul className="space-y-2.5 text-sm">
                {orders.orders.slice(0, 4).map((o) => (
                  <li key={o.orderId} className="flex items-center justify-between gap-3 border-b border-line/60 pb-2.5 last:border-0">
                    <span className="font-mono text-[13px] text-ok">{o.orderId}</span>
                    <span className="flex-1 truncate text-mut">{o.serviceLabel}</span>
                    <StatusChip status={o.ok ? 'SETTLED' : 'REJECTED'} />
                    <span className="font-mono text-[13px] text-mut">{atomsUsd(o.amountAtoms)} USD</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Identity">
            <div className="space-y-4 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wider text-mut">Agent address</div>
                <div className="mt-1"><Address addr={s.agent.address} /></div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-mut">Planner</div>
                <div className="mt-1 font-mono text-ink">deterministic 10-step</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-mut">Rail</div>
                <div className="mt-1 font-mono text-ok">x402 · veil-exact</div>
              </div>
            </div>
          </Card>

          <Card title="Tool surface" right={<span className="font-mono text-[11px] text-mut">exactly 8</span>}>
            <ul className="space-y-2">
              {TOOLS.map(([name, note], i) => (
                <li
                  key={name}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-[13px] ${
                    i >= 6 ? 'border-ok/30 bg-ok/5 text-ok' : 'border-line bg-panel2/60 text-mut'
                  }`}
                >
                  <span className="font-mono">{name}</span>
                  <span className="text-mut">{note}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-mut">
              No settle / refund / revoke / budget / verify / mandate tool exists. The agent can only shop; the ledger
              and operator settle.
            </p>
          </Card>
        </div>
      </div>

      <div className="mt-8">
        <KillSwitch state={s} />
      </div>
    </div>
  );
}