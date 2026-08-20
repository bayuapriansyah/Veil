'use client';

import { Card, PageHeader, Stat, StatusChip, Address } from '@/components/ui';
import { BudgetGauge, KillSwitch } from '@/components/flow-control';
import { VeilState, atomsUsd, timeAgo } from '@/lib/veil-client';
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
};

export default function MandatePage(): React.ReactElement {
  const { data } = usePoll<{ ok: boolean; state: VeilState }>('/api/veil/state', { ok: true, state: EMPTY_STATE });
  const s = data.state ?? EMPTY_STATE;
  const m = s.currentMandate;

  return (
    <div>
      <PageHeader
        title="Mandate"
        sub="The user mandate is registered on EVERY provider ledger (each ledger is the authority for its own purchases). Spending increments only at operator settlement."
        right={
          <StatusChip
            status={m && !m.revoked ? 'VERIFIED' : 'REJECTED'}
            label={m ? (m.revoked ? 'REVOKED' : 'ACTIVE') : 'NONE'}
          />
        }
      />

      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <Stat label="Budget" value={m ? atomsUsd(m.budgetAtoms) : 'N/A'} />
        <Stat label="Spent" value={m ? atomsUsd(m.spentAtoms) : 'N/A'} sub="settlement is when spend counts" />
        <Stat label="Remaining" value={m ? atomsUsd(m.remainingAtoms) : 'N/A'} tone={m && Number(BigInt(m.remainingAtoms)) > 0 ? 'ok' : 'bad'} />
        <Stat label="Expires" value={m ? timeAgo(m.expiresAt) : 'N/A'} />
      </div>

      <div className="mt-8 grid gap-7 lg:grid-cols-2">
        <Card title="Spend curve" right={<span className="font-mono text-[11px] text-mut">release-only</span>}>
          {m ? (
            <div className="space-y-5">
              <BudgetGauge budgetAtoms={m.budgetAtoms} spentAtoms={m.spentAtoms} />
              <div className="grid grid-cols-2 gap-3 text-[15px] sm:grid-cols-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-mut">Mandate id</div>
                  <div className="font-mono text-ink">{m.mandateId}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-mut">Owner</div>
                  <div className="font-mono text-mut">{m.owner.slice(0, 12)}…</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-mut">Service</div>
                  <div className="text-ink">{m.serviceLabel}</div>
                </div>
              </div>
              <div className="rounded-lg border border-line bg-panel2/70 p-4 text-sm leading-relaxed text-mut">
                Budget ceiling <span className="font-mono text-ink">{m.budgetAtoms}</span> atoms · spent{' '}
                <span className="font-mono text-ink">{m.spentAtoms}</span> atoms · remaining{' '}
                <span className="font-mono text-ink">{m.remainingAtoms}</span> atoms.
              </div>
            </div>
          ) : (
            <p className="text-sm text-mut">No mandate registered.</p>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Enforcement model">
            <ul className="space-y-3 text-[15px]">
              <li className="flex justify-between gap-2">
                <span className="text-mut">Validity</span>
                <span className="font-mono text-ok">not revoked · in scope · funded</span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-mut">Spend timing</span>
                <span className="font-mono text-mut">@ escrow release</span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-mut">Provider gate</span>
                <span className="font-mono text-ok">reputation ≥ 3</span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-mut">Authority</span>
                <span className="font-mono text-mut">ledger, not agent</span>
              </li>
            </ul>
            <p className="mt-5 text-sm leading-relaxed text-mut">
              A kill switch below revokes this mandate on every provider ledger and the agent then refuses all future
              purchases at the gate.
            </p>
          </Card>
          <KillSwitch state={s} />
        </div>
      </div>
    </div>
  );
}