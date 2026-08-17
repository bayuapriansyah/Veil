'use client';

import { ReactNode } from 'react';
import { STATUS_STYLE, TxStatus, shortAddress, txShort } from '../lib/veil-client';

export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }): React.ReactElement {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-mono text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-mut">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Card({ title, children, right, className = '' }: { title?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }): React.ReactElement {
  return (
    <section className={`panel p-5 ${className}`}>
      {title && (
        <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-ink">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone = 'default' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'bad' | 'pend' | 'default' }): React.ReactElement {
  const color =
    tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : tone === 'pend' ? 'text-pend' : 'text-ink';
  return (
    <div className="panel p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-mut">{label}</div>
      <div className={`mt-2 font-mono text-2xl font-semibold ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-mut">{sub}</div>}
    </div>
  );
}

export function StatusChip({ status, label }: { status: TxStatus; label?: string }): React.ReactElement {
  const st = STATUS_STYLE[status] ?? STATUS_STYLE.PENDING;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${st.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
      {label ?? st.label}
    </span>
  );
}

export function Address({ addr, href, className = '' }: { addr: string; href?: string; className?: string }): React.ReactElement {
  const text = <span className={`font-mono text-xs ${className}`}>{shortAddress(addr)}</span>;
  if (!href) return text;
  return <a href={href}>{text}</a>;
}

export function TxId({ id }: { id: string }): React.ReactElement {
  return <span className="font-mono text-xs text-attest">{txShort(id)}</span>;
}

export function Empty({ message }: { message: string }): React.ReactElement {
  return <div className="py-8 text-center text-sm text-mut">{message}</div>;
}