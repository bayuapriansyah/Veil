'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowsLeftRight,
  Fingerprint,
  Gauge,
  LineSegments,
  Robot,
  Storefront,
  Stack,
} from '@phosphor-icons/react';
import { VeilState, shortAddress } from '../../lib/veil-client';
import { usePoll } from '../../lib/use-poll';

const NAV = [
  { href: '/app', label: 'Dashboard', icon: Gauge, match: '/' },
  { href: '/app/agents', label: 'Agents', icon: Robot, match: '/app/agents' },
  { href: '/app/mandates', label: 'Mandates', icon: Stack, match: '/app/mandates' },
  { href: '/app/transactions', label: 'Transactions', icon: ArrowsLeftRight, match: '/app/transactions' },
  { href: '/app/audit', label: 'Audit', icon: Fingerprint, match: '/app/audit' },
  { href: '/app/providers', label: 'Providers', icon: Storefront, match: '/app/providers' },
  { href: '/app/canvas', label: 'Agent Economy', icon: LineSegments, match: '/app/canvas' },
] as const;

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

export function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();
  const { data } = usePoll<{ ok: boolean; state: VeilState }>('/api/veil/state', { ok: true, state: EMPTY_STATE }, 4000);
  const s = data.state ?? EMPTY_STATE;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-panel2/40">
        <Link href="/" className="flex items-center gap-3 border-b border-line px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-attest/40 bg-attest/10 font-mono text-attest">
            V
          </div>
          <div>
            <div className="font-mono text-sm font-semibold tracking-[0.2em] text-ink">VEIL</div>
            <div className="text-[10px] uppercase tracking-wider text-mut">Agent Economy</div>
          </div>
        </Link>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((n) => {
            const active = n.href === '/app' ? pathname === '/app' : pathname.startsWith(n.match);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active ? 'bg-attest/10 text-attest' : 'text-mut hover:bg-panel2 hover:text-ink'
                }`}
              >
                <Icon size={16} weight="regular" />
                <span>{n.label}</span>
                {n.label === 'Audit' && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-ok" />}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-line px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-pend/40 bg-pend/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-pend">
              <span className="h-1.5 w-1.5 rounded-full bg-pend" />
              TESTNET DEMO
            </span>
            <span
              className={`h-2 w-2 rounded-full ${
                s.killSwitch ? 'bg-bad' : s.agent.status === 'active' ? 'bg-ok animate-pulse' : 'bg-pend'
              }`}
            />
          </div>
          <div className="flex items-center justify-between font-mono text-[11px] text-mut">
            <span>key:{s.keySource || '…'}</span>
            <span className="text-attest/70">{shortAddress(s.agent.address, 3)}</span>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-mut">
            {s.killSwitch ? 'KILL SWITCHED' : s.agent.status.toUpperCase()}
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden px-8 py-7">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}