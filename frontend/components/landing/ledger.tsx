'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

const TABS = [
  {
    id: 'escrow',
    code: '1E',
    title: 'Escrow, not advance',
    accent: '#46c787',
    quote:
      'Funds leave the budget only when the operator releases escrow. The ledger stays the single authority on what may be paid — the agent never touches the keys.',
    meta: 'Escrow released only on verified proof',
    detail: 'SettlementLedger',
  },
  {
    id: 'proof',
    code: 'P·',
    title: 'Proof before settlement',
    accent: '#46c787',
    quote:
      'Payment and fulfillment are each attested cross-chain. Settlement refuses to run unless both sides verify against the recorded parties.',
    meta: 'Attestcoin + Creditcoin, the same code path',
    detail: 'Attestation layer',
  },
  {
    id: 'vault',
    code: 'V·',
    title: 'Sealed audit vault',
    accent: '#46c787',
    quote:
      'The public register holds only facts — tx id, commitment, status. Amounts, evidence and agent identity stay sealed with AES-256-GCM and open only to authorized auditors.',
    meta: 'Facts public · evidence sealed',
    detail: 'Audit vault',
  },
  {
    id: 'revoke',
    code: 'R·',
    title: 'Human at the kill switch',
    accent: '#d85c5c',
    quote:
      'Every provider ledger honors the same mandate. One revoke makes every future purchase refuse at the gate — before the transaction exists.',
    meta: 'Instant, hard refusal',
    detail: 'Operator control',
  },
] as const;

const RAIL = ['USER', 'AGENT', 'PAYMENT', 'ATTESTCOIN', 'FULFILLMENT', 'CREDITCOIN', 'AUDIT'] as const;

export function LedgerWitness(): React.ReactElement {
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();

  return (
    <section id="ledger" className="relative border-t border-line bg-paper px-6 py-24 md:py-32">
      <div className="mx-auto max-w-5xl">
        <h2
          className="blur-in mb-16 text-4xl font-medium leading-tight text-ink sm:text-5xl lg:text-6xl"
          style={{ animationDelay: '0.05s' }}
        >
          The ledger is <em className="font-serif italic text-attest">the witness.</em>
        </h2>

        <div className="mb-16 grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="flex items-start justify-start gap-4 lg:gap-6" role="tablist" aria-label="Statements">
            {TABS.map((t, i) => {
              const isActive = i === active;
              const r = 48;
              const C = 2 * Math.PI * r;
              return (
                <div
                  key={t.id}
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActive(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActive(i);
                    }
                  }}
                  className="relative cursor-pointer"
                  style={{ outline: 'none' }}
                >
                  <motion.div
                    className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full transition-colors duration-500 sm:h-20 sm:w-20 lg:h-24 lg:w-24"
                    animate={{ backgroundColor: isActive ? t.accent : 'transparent' }}
                    transition={{ duration: 0.4 }}
                  >
                    <span
                      className={`font-mono text-sm font-semibold sm:text-base lg:text-lg ${
                        isActive ? 'text-bg' : 'text-mut'
                      }`}
                    >
                      {t.code}
                    </span>
                  </motion.div>
                  <svg
                    className="absolute -inset-2 h-[calc(100%+16px)] w-[calc(100%+16px)] -rotate-90"
                    viewBox="0 0 100 100"
                    aria-hidden="true"
                  >
                    <circle cx="50" cy="50" r={r} fill="none" stroke={t.accent} strokeWidth="1.5" opacity="0.2" />
                    {isActive && !reduce && (
                      <circle
                        cx="50"
                        cy="50"
                        r={r}
                        fill="none"
                        stroke={t.accent}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeDasharray={C}
                        strokeDashoffset={C}
                        style={{ animation: 'veil-ring 1.4s cubic-bezier(0.22,1,0.36,1) forwards' }}
                      />
                    )}
                  </svg>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col justify-center">
            <motion.blockquote
              key={active}
              className="mb-6 font-mono text-lg leading-relaxed text-mut"
              initial={reduce ? undefined : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              {TABS[active].quote}
            </motion.blockquote>
            <div className="text-base font-medium text-ink">
              {TABS[active].title}
              <span className="ml-2 text-mut">· {TABS[active].meta}</span>
            </div>
            <div className="mt-2 font-mono text-xs text-mut/70">{TABS[active].detail}</div>
          </div>
        </div>

        {/* Rail */}
        <div className="mt-10">
          <div className="overflow-x-auto pb-2">
            <div className="flex min-w-[720px] items-center py-4">
              {RAIL.map((node, i) => (
                <div key={node} className="flex flex-1 items-center">
                  <div className="flex min-w-[80px] flex-col items-center text-center">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full border border-attest/50 bg-attest/10 font-mono text-[11px] text-attest">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-mut">{node}</span>
                  </div>
                  {i < RAIL.length - 1 && <span className="h-px flex-1 bg-line" aria-hidden="true" />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes veil-ring {
          from {
            stroke-dashoffset: ${2 * Math.PI * 48};
          }
          to {
            stroke-dashoffset: 0;
          }
        }
      `}</style>
    </section>
  );
}
