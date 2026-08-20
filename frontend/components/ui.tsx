'use client';

import { ReactNode } from 'react';
import { STATUS_STYLE, TxStatus, shortAddress, txShort } from '../lib/veil-client';

export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }): React.ReactElement {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 md:mb-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">{title}</h1>
        {sub && <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-mut">{sub}</p>}
      </div>
      {right && <div className="flex items-center gap-3">{right}</div>}
    </div>
  );
}

export function Card({ title, children, right, className = '' }: { title?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }): React.ReactElement {
  return (
    <section className={`panel p-5 md:p-6 ${className}`}>
      {title && (
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
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
    <div className="panel p-5 md:p-6">
      <div className="text-xs font-medium uppercase tracking-wider text-mut">{label}</div>
      <div className={`mt-2.5 text-2xl font-semibold tracking-tight md:text-3xl ${color}`}>{value}</div>
      {sub && <div className="mt-1.5 text-sm text-mut/90">{sub}</div>}
    </div>
  );
}

export function StatusChip({ status, label }: { status: TxStatus; label?: string }): React.ReactElement {
  const st = STATUS_STYLE[status] ?? STATUS_STYLE.PENDING;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[11px] font-medium uppercase tracking-wide ${st.chip}`}>
      <span className={`h-2 w-2 rounded-full ${st.dot}`} />
      {label ?? st.label}
    </span>
  );
}

export function Address({ addr, href, className = '' }: { addr: string; href?: string; className?: string }): React.ReactElement {
  const text = <span className={`font-mono text-[13px] ${className}`}>{shortAddress(addr)}</span>;
  if (!href) return text;
  return <a href={href}>{text}</a>;
}

export function TxId({ id }: { id: string }): React.ReactElement {
  return <span className="font-mono text-[13px] text-ok">{txShort(id)}</span>;
}

export function Empty({ message, icon }: { message: string; icon?: ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-panel2 text-mut">
          {icon}
        </div>
      )}
      <p className="max-w-md text-[15px] text-mut">{message}</p>
    </div>
  );
}