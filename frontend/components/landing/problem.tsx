'use client';

import { X, Check } from '@phosphor-icons/react';
import { Reveal } from './reveal';

const TODAY = [
  'Agents hold a wallet key and spend without receipts',
  'Payment is a fire-and-forget tx, outcome unverified',
  'No proof that the work you paid for ever happened',
  'Debugging agent spend means trusting logs',
  'The only off switch is deleting the key',
];

const VEIL = [
  'Agent shops through a 7-tool rail, never keys',
  'Payment locks in escrow until proof arrives',
  'Fulfillment is attested and settlement only on proof',
  'Every spend is sealed into a selective audit register',
  'One kill switch revokes every mandate at once',
];

export function Problem(): React.ReactElement {
  return (
    <section id="problem" className="mx-auto max-w-6xl px-6 py-20 md:py-28">
      <Reveal>
        <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-ink md:text-4xl">
          Autonomous agents need money. Money needs proof.
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-mut">
          Letting an agent spend funds is easy. Verifying that the money moved for delivered, attested work is not. Most
          agent stacks optimize the spend and skip the ledger.
        </p>
      </Reveal>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <Reveal delay={0.05}>
          <div className="h-full rounded-card border border-line bg-panel p-7">
            <h3 className="font-mono text-sm font-semibold uppercase tracking-wider text-bad">Today</h3>
            <ul className="mt-6 space-y-3.5">
              {TODAY.map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm leading-relaxed text-mut">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-bad/40 bg-bad/10">
                    <X size={11} weight="bold" className="text-bad" />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
        <Reveal delay={0.12}>
          <div className="h-full rounded-card border border-attest/40 bg-panel p-7">
            <h3 className="font-mono text-sm font-semibold uppercase tracking-wider text-attest">VEIL</h3>
            <ul className="mt-6 space-y-3.5">
              {VEIL.map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm leading-relaxed text-ink">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-attest/40 bg-attest/10">
                    <Check size={11} weight="bold" className="text-attest" />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}