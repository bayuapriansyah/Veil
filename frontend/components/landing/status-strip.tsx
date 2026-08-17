'use client';

import { Fingerprint, Robot, ShieldCheck, Storefront } from '@phosphor-icons/react';
import { atomsUsd } from '../../lib/veil-client';
import { useLive } from './use-live';

export function StatusStrip(): React.ReactElement {
  const { state, live } = useLive(4000);

  const items = [
    {
      icon: ShieldCheck,
      label: 'Agent control',
      value: state.killSwitch ? 'KILLED' : state.agent.status.toUpperCase(),
      tone: state.killSwitch ? 'text-bad' : 'text-ok',
      dot: state.killSwitch ? 'bg-bad' : 'bg-ok',
      note: 'kill switch armed',
    },
    {
      icon: Fingerprint,
      label: 'Verified purchases',
      value: String(state.verifiedTransactions),
      tone: 'text-attest',
      dot: 'bg-attest',
      note: `${state.transactionCount} attempted`,
    },
    {
      icon: Storefront,
      label: 'Registered providers',
      value: String(state.providersCount),
      tone: 'text-ink',
      dot: 'bg-line',
      note: 'reputation ≥ 3 eligible',
    },
    {
      icon: Robot,
      label: 'Escrow reserved',
      value: `${atomsUsd(state.reservedAtoms)} USD`,
      tone: 'text-pend',
      dot: 'bg-pend',
      note: `budget ${atomsUsd(state.remainingAtoms)} left`,
    },
  ];

  return (
    <section className="border-b border-line bg-paper" aria-label="System status">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow">System status</p>
          <span className="flex items-center gap-2 font-mono text-[11px] text-mut">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            {live ? 'live mirror state' : 'awaiting data'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line md:grid-cols-4">
          {items.map((it) => (
            <div key={it.label} className="bg-paper p-5">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-mut">
                <it.icon size={14} weight="regular" />
                {it.label}
              </div>
              <div className={`mt-3 font-mono text-2xl font-semibold ${it.tone}`}>{it.value}</div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-mut">
                <span className={`h-1.5 w-1.5 rounded-full ${it.dot}`} />
                {it.note}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}