'use client';

import { Key, LockSimple, Receipt, Robot, Scissors, ShieldCheck } from '@phosphor-icons/react';
import { Reveal } from './reveal';

const FEATURES = [
  {
    icon: Key,
    title: 'No wallet for the agent',
    body: 'The agent shops through tools. It never holds a payment key it could leak or be coerced to use.',
    span: 'md:col-span-2',
  },
  {
    icon: ShieldCheck,
    title: 'Attested payment',
    body: 'Payments commit to Attestcoin and settle only on proof, mirrored honestly in the demo.',
    span: '',
  },
  {
    icon: Scissors,
    title: 'Kill switch',
    body: 'One revoke refuses every future purchase on every provider ledger, at the gate.',
    span: '',
  },
  {
    icon: LockSimple,
    title: 'Sealed audit vault',
    body: 'AES-256-GCM keeps evidence private. Only authorized auditors decrypt on demand.',
    span: '',
  },
  {
    icon: Receipt,
    title: 'Release-only spend',
    body: 'The budget decrements only at operator settlement, never on intent.',
    span: '',
  },
  {
    icon: Robot,
    title: 'Provider reputation gate',
    body: 'Discovery excludes providers below reputation 3, so the agent never meets untrusted shops.',
    span: 'md:col-span-2',
  },
] as const;

export function Features(): React.ReactElement {
  return (
    <section id="features" className="border-y border-line bg-paper">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <Reveal>
          <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-ink md:text-4xl">
            Built for the operator, not the demo.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={0.05 * i} className={`bg-paper ${f.span}`}>
              <div className="flex h-full flex-col p-7">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-control border border-attest/30 bg-attest/5">
                  <f.icon size={20} weight="regular" className="text-attest" />
                </span>
                <h3 className="mt-5 text-base font-semibold text-ink">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mut">{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}