'use client';

import { Robot } from '@phosphor-icons/react';
import Link from 'next/link';
import { Card, PageHeader, StatusChip } from '../../../components/ui';
import { ProviderView, VeilState, shortAddress } from '../../../lib/veil-client';
import { usePoll } from '../../../lib/use-poll';

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

export default function AgentsPage(): React.ReactElement {
  const { data } = usePoll<{ ok: boolean; state: VeilState }>('/api/veil/state', { ok: true, state: EMPTY_STATE });
  const { data: providers } = usePoll<{ ok: boolean; providers: ProviderView[] }>('/api/veil/providers', {
    ok: true,
    providers: [],
  });
  const s = data.state ?? EMPTY_STATE;
  const registry = providers.providers ?? [];

  return (
    <div>
      <PageHeader
        title="Agents"
        sub="One operator agent drives the purchases; every provider runs its own settlement ledger behind it. Open an agent to inspect its identity, tool surface and live rail."
      />

      <Card title="Operator agent" right={<StatusChip status={s.agent.status === 'active' ? 'VERIFIED' : 'REJECTED'} label={s.agent.status.toUpperCase()} />}>
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-ok/40 bg-ok/10">
              <Robot size={26} weight="regular" className="text-ok" />
            </div>
            <div>
              <div className="font-mono text-base text-ink">{shortAddress(s.agent.address, 6)}</div>
              <div className="mt-0.5 text-sm text-mut">deterministic planner · 7 tools</div>
            </div>
          </div>
          <Link href={`/app/agents/${s.agent.address}`} className="btn-muted">
            Open cockpit
          </Link>
        </div>
      </Card>

      <div className="mt-8">
        <h2 className="mb-4 text-base font-semibold text-ink">Provider agents</h2>
        <div className="grid gap-5 md:grid-cols-2">
          {registry.map((p) => (
            <Card
              key={p.provider}
              title={
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm">{shortAddress(p.provider, 6)}</span>
                  <StatusChip status={p.eligible ? 'VERIFIED' : 'REJECTED'} label={p.eligible ? 'ELIGIBLE' : 'EXCLUDED'} />
                </div>
              }
              right={<span className="font-mono text-sm text-pend">rep {p.reputation}</span>}
            >
              <div className="flex items-center justify-between text-sm text-mut">
                <span>{p.services.length} service(s)</span>
                <span>{p.activeMandates} active mandates</span>
              </div>
              <div className="mt-4 space-y-2.5">
                {p.services.slice(0, 2).map((sv) => (
                  <div key={sv.serviceId} className="rounded-lg border border-line bg-panel2/70 px-3.5 py-2.5 text-sm">
                    <span className="font-medium text-ink">{sv.name}</span>
                    <span className="ml-2 text-mut">{sv.description}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          {registry.length === 0 && <p className="text-sm text-mut">Loading provider catalog…</p>}
        </div>
      </div>
    </div>
  );
}