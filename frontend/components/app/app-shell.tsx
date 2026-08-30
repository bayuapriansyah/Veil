'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowsLeftRight,
  CaretRight,
  Eye,
  Fingerprint,
  Gauge,
  LineSegments,
  List,
  Robot,
  Storefront,
  Stack,
  X,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { VeilState, shortAddress } from '../../lib/veil-client';
import { usePoll } from '../../lib/use-poll';
import { ConnectWallet } from '../connect-wallet';
import { Warning } from '@phosphor-icons/react';

interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  match: string;
}

const GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Operations',
    items: [
      { href: '/app', label: 'Dashboard', icon: Gauge, match: '/app' },
      { href: '/app/agents', label: 'Agents', icon: Robot, match: '/app/agents' },
      { href: '/app/mandates', label: 'Mandates', icon: Stack, match: '/app/mandates' },
    ],
  },
  {
    label: 'Explorers',
    items: [
      { href: '/app/transactions', label: 'Transactions', icon: ArrowsLeftRight, match: '/app/transactions' },
      { href: '/app/audit', label: 'Audit', icon: Fingerprint, match: '/app/audit' },
      { href: '/app/privacy', label: 'Privacy Model', icon: Eye, match: '/app/privacy' },
      { href: '/app/providers', label: 'Providers', icon: Storefront, match: '/app/providers' },
    ],
  },
  {
    label: 'Network',
    items: [{ href: '/app/canvas', label: 'Agent Economy', icon: LineSegments, match: '/app/canvas' }],
  },
];

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

function SidebarBody({
  s,
  live,
  onNavigate,
}: {
  s: VeilState;
  live: 'ok' | 'bad' | 'pend';
  onNavigate?: () => void;
}): React.ReactElement {
  const pathname = usePathname();
  return (
    <>
      <Link
        href="/"
        onClick={onNavigate}
        className="flex items-center gap-3 border-b border-line px-6 py-6"
      >
        <div className="flex h-10 items-center justify-center overflow-hidden rounded-xl border border-ok/50 bg-ok/10">
          <Image src="/logo.jpg" alt="VEIL" width={80} height={40} className="h-full w-auto object-contain" />
        </div>
        <div>
          <div className="font-mono text-sm font-semibold tracking-[0.2em] text-ink">VEIL</div>
          <div className="text-[11px] uppercase tracking-wider text-mut/70">Agent Economy</div>
        </div>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3.5 py-5" aria-label="App">
        {GROUPS.map((g) => (
          <div key={g.label} className="mb-6 last:mb-0">
            <div className="mb-2.5 px-3 font-mono text-[12px] font-medium uppercase tracking-[0.18em] text-mut/60">
              {g.label}
            </div>
            <div className="space-y-1">
              {g.items.map((item) => {
                const active =
                  item.href === '/app' ? pathname === '/app' : pathname.startsWith(item.match);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-xl font-medium transition-colors ${
                      active ? 'bg-ok/10 text-ok' : 'text-mut hover:bg-panel2/80 hover:text-ink'
                    }`}
                  >
                    <Icon
                      size={22}
                      weight={active ? 'fill' : 'regular'}
                      className={active ? 'text-ok' : 'text-mut group-hover:text-ink'}
                    />
                    <span>{item.label}</span>
                    {item.label === 'Audit' && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-ok" />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-4">
        <div className="rounded-xl border border-line bg-panel p-4">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider ${
                s.mode === 'production'
                  ? 'border-bad/50 bg-bad/10 text-bad'
                  : 'border-pend/50 bg-pend/10 text-pend'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${s.mode === 'production' ? 'bg-bad animate-pulse' : 'bg-pend'}`} />
              {s.mode === 'production' ? 'LIVE' : 'Demo'}
            </span>
            <span
              className={`h-2 w-2 rounded-full ${live === 'bad' ? 'bg-bad' : live === 'ok' ? 'bg-ok' : 'bg-pend'}`}
            />
          </div>
          {s.mode === 'production' && (
            <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-bad/30 bg-bad/5 px-2.5 py-1.5">
              <Warning size={12} className="shrink-0 text-bad" />
              <span className="font-mono text-[10px] text-bad/80">Real CTC gas fees apply</span>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-mut">
            <span>key:{s.keySource || '…'}</span>
            <span className="text-ok">{shortAddress(s.agent.address, 3)}</span>
          </div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-mut/80">
            {s.killSwitch ? 'kill switch engaged' : s.agent.status}
          </div>
        </div>
      </div>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();
  const { data } = usePoll<{ ok: boolean; state: VeilState }>('/api/veil/state', { ok: true, state: EMPTY_STATE }, 4000);
  const s = data.state ?? EMPTY_STATE;
  const [open, setOpen] = useState(false);

  const flat = GROUPS.flatMap((g) => g.items);
  const current = flat.find((n) => (n.href === '/app' ? pathname === '/app' : pathname.startsWith(n.match)));
  const live = s.killSwitch ? 'bad' : s.agent.status === 'active' ? 'ok' : 'pend';

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-ink">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-line bg-side lg:flex">
        <SidebarBody s={s} live={live} />
      </aside>

      <div className={`fixed inset-0 z-50 lg:hidden ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
        <div
          className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setOpen(false)}
        />
        <motion.div
          initial={false}
          animate={{ x: open ? 0 : '-100%' }}
          transition={{ type: 'tween', duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-line bg-side shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button
            className="absolute right-3 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel text-mut transition-colors hover:text-ink"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          >
            <X size={16} weight="bold" />
          </button>
          <SidebarBody s={s} live={live} onNavigate={() => setOpen(false)} />
        </motion.div>
      </div>

      <main className="flex min-w-0 flex-1 flex-col h-full overflow-hidden">
        <header className="flex h-[68px] shrink-0 items-center justify-between gap-3 border-b border-line bg-bg px-4 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-2 font-mono text-sm text-mut">
            <button
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel text-mut transition-colors hover:text-ink lg:hidden"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
            >
              <List size={18} weight="bold" />
            </button>
            <Link href="/" className="flex shrink-0 items-center gap-2 transition-colors hover:text-ink">
              <Image src="/logo.jpg" alt="VEIL" width={80} height={24} className="h-6 w-auto object-contain" />
              <span className="hidden sm:inline">VEIL</span>
            </Link>
            <CaretRight size={13} weight="bold" className="shrink-0" />
            <span className="truncate text-ink">{current?.label ?? 'Console'}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <ConnectWallet />
            <span className="hidden items-center gap-2 rounded-full border border-line bg-panel px-3.5 py-1.5 font-mono text-[11px] text-mut sm:inline-flex">
              <span
                className={`h-1.5 w-1.5 rounded-full ${live === 'bad' ? 'bg-bad' : live === 'ok' ? 'bg-ok' : 'bg-pend'}`}
              />
              {s.killSwitch ? 'KILL SWITCHED' : s.agent.status === 'active' ? 'OPERATIONAL' : s.agent.status.toUpperCase()}
            </span>
            <div
              className={`flex h-9 items-center justify-center overflow-hidden rounded-lg transition-colors ${
                s.killSwitch ? 'bg-bad/15' : 'bg-ok/15'
              }`}
            >
              <Image src="/logo.jpg" alt="VEIL" width={60} height={36} className="h-full w-auto object-contain" />
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          <div className="mx-auto max-w-7xl">{children}</div>
        </div>
      </main>
    </div>
  );
}