'use client';

import { Reveal } from './reveal';

const STEPS = [
  {
    id: '01',
    node: 'USER',
    title: 'Set a mandate and budget',
    body: 'You register a service mandate with a spending ceiling. Every provider ledger mirrors it.',
  },
  {
    id: '02',
    node: 'AI AGENT',
    title: 'The agent plans and shops',
    body: 'A deterministic planner works a 7-tool surface: discovery, reputation, budget checks, then a reservation. No privileged tools.',
  },
  {
    id: '03',
    node: 'PAYMENT',
    title: 'Payment locks in escrow',
    body: 'The only payment path gates on mandate and budget, then reserves the amount against escrow.',
  },
  {
    id: '04',
    node: 'ATTESTCOIN',
    title: 'Payment is attested',
    body: 'A cross-chain attestation commits the payment proof to Attestcoin (mirrored in this demo rail).',
  },
  {
    id: '05',
    node: 'FULFILLMENT',
    title: 'Work is delivered and attested',
    body: 'The provider returns a result. Its fulfillment receipt is recorded and verified against the ordering party.',
  },
  {
    id: '06',
    node: 'CREDITCOIN',
    title: 'Escrow settles',
    body: 'Only after both verifications does the operator release escrow and settle the spend on Creditcoin.',
  },
  {
    id: '07',
    node: 'AUDIT',
    title: 'A sealed register records it',
    body: 'Public facts land in the audit vault; amounts and evidence stay sealed until an authorized auditor opens them.',
  },
] as const;

export function HowItWorks(): React.ReactElement {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-20 md:py-28">
      <Reveal>
        <p className="eyebrow">How it works</p>
        <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-ink md:text-4xl">
          Seven steps from intent to settled, attested work.
        </h2>
      </Reveal>

      <ol className="mt-12">
        {STEPS.map((s, i) => (
          <Reveal key={s.id} delay={0.04 * i}>
            <li className="group relative flex gap-6 pb-10 last:pb-0 md:gap-10">
              {i < STEPS.length - 1 && (
                <span className="absolute left-[26px] top-14 h-[calc(100%-28px)] w-px bg-line md:left-[34px]" aria-hidden="true" />
              )}
              <span className="z-10 flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-card border border-line bg-panel2 font-mono text-sm text-attest transition-colors group-hover:border-attest/50 md:h-[68px] md:w-[68px]">
                {s.id}
              </span>
              <div className="pt-1">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-mut">{s.node}</span>
                  <h3 className="text-lg font-semibold text-ink md:text-xl">{s.title}</h3>
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mut md:text-base">{s.body}</p>
              </div>
            </li>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}