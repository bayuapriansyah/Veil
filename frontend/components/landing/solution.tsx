'use client';

import { LockKey, ShieldCheck, Fingerprint, Scales } from '@phosphor-icons/react';
import { Reveal } from './reveal';

const PILLARS = [
  {
    Icon: LockKey,
    title: 'Escrow, not advance',
    body: 'Funds leave the budget only when the operator releases escrow. The ledger stays the single authority on what may be paid.',
    accent: 'text-settle border-settle/40 bg-settle/10',
    span: '',
  },
  {
    Icon: ShieldCheck,
    title: 'Proof before settlement',
    body: 'Payment and fulfillment are each attested. Settlement refuses to run unless both sides verify against the recorded parties.',
    accent: 'text-attest border-attest/40 bg-attest/10',
    span: 'md:col-span-2',
  },
  {
    Icon: Fingerprint,
    title: 'Selective audit',
    body: 'The public register holds only facts. Amounts, evidence and agent identity stay sealed with AES-256-GCM and open only to authorized auditors.',
    accent: 'text-agent border-agent/40 bg-agent/10',
    span: 'md:col-span-2',
  },
  {
    Icon: Scales,
    title: 'Human at the kill switch',
    body: 'Every provider ledger honors the same mandate. One revoke makes every future purchase refuse at the gate.',
    accent: 'text-provider border-provider/40 bg-provider/10',
    span: '',
  },
];

function Pillar({
  pillar,
  delay,
  className = '',
}: {
  pillar: (typeof PILLARS)[number];
  delay: number;
  className?: string;
}): React.ReactElement {
  return (
    <Reveal delay={delay} className={`bg-paper ${className}`}>
      <div className="flex h-full flex-col p-7">
        <span className={`inline-flex h-11 w-11 items-center justify-center rounded-control border ${pillar.accent}`}>
          <pillar.Icon size={20} weight="regular" />
        </span>
        <h3 className="mt-5 text-lg font-semibold text-ink">{pillar.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-mut">{pillar.body}</p>
      </div>
    </Reveal>
  );
}

export function Solution(): React.ReactElement {
  return (
    <section id="solution" className="border-y border-line bg-paper">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <Reveal>
          <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-ink md:text-4xl">
            A rail built on four rules.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Pillar key={p.title} pillar={p} delay={0.06 * i} className={p.span} />
          ))}
        </div>
      </div>
    </section>
  );
}