'use client';

import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { ArrowDownRight } from '@phosphor-icons/react';
import { useLive } from './use-live';
import { STAGE_SEQUENCE } from '../../lib/veil-client';

const MARQUEE = [
  'ATTESTCOIN',
  'CREDITCOIN',
  'X402',
  'SEPOLIA',
  'SOLIDITY',
  'TYPESCRIPT',
  'ETHERSCAN',
  'AES-256-GCM',
] as const;

function stageState(
  key: string,
  stages: Array<{ key: string; status: string }>,
): { done: boolean; bad: boolean; label: string } {
  const st = stages.find((s) => s.key === key);
  if (!st) return { done: false, bad: false, label: 'PENDING' };
  const done = st.status === 'VERIFIED' || st.status === 'SETTLED';
  const bad = st.status === 'FAILED' || st.status === 'REJECTED' || st.status === 'REFUNDED';
  return { done, bad, label: st.status };
}

export function Hero(): React.ReactElement {
  const { live, lastOrder, state } = useLive(2000);
  const reduce = useReducedMotion();
  const stages = lastOrder?.stages ?? [];

  return (
    <section className="relative flex flex-col overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 75% 0%, rgba(70,199,135,0.08) 0%, transparent 65%), radial-gradient(45% 40% at 20% 10%, rgba(38,48,58,0.5) 0%, transparent 60%)',
        }}
      />
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(80%_60%_at_50%_0%,black,transparent)]" aria-hidden="true" />

      <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center px-6 pb-10 pt-36 text-center md:pt-44">
        <motion.div
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-1.5 text-sm font-medium text-ink"
          initial={reduce ? undefined : { opacity: 0, filter: 'blur(8px)', y: 20 }}
          animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          Escrowed, cross-chain-attested payment rail
        </motion.div>

        <h1 className="mt-8 text-6xl font-medium leading-[1.05] tracking-tight text-ink sm:text-7xl md:text-8xl">
          <span className="blur-in block" style={{ animationDelay: '0.08s' }}>
            Agents act.
          </span>
          <span className="blur-in block" style={{ animationDelay: '0.16s' }}>
            Humans <em className="font-serif italic text-attest">verify.</em>
          </span>
        </h1>

        <p
          className="blur-in mt-7 max-w-xl text-lg leading-relaxed text-mut"
          style={{ animationDelay: '0.24s' }}
        >
          Every payment is escrowed, attested across chains, and settled only on proof. One kill
          switch revokes every mandate at once.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link href="/app" className="group relative inline-flex items-center">
            <span className="absolute right-0 inset-y-0 w-[calc(100%-2rem)] rounded-2xl bg-attest/90" />
            <span className="relative z-10 rounded-2xl bg-ink px-6 py-3 text-sm font-medium text-bg transition-colors hover:bg-white">
              Launch VEIL
            </span>
            <span className="relative -left-px z-10 flex h-11 w-11 items-center justify-center rounded-2xl text-bg">
              <ArrowDownRight
                size={20}
                weight="bold"
                className="transition-transform duration-300 group-hover:-rotate-45"
              />
            </span>
          </Link>
          <a
            href="#ledger"
            className="inline-flex items-center gap-2 rounded-2xl border border-line bg-panel px-6 py-3 text-sm font-medium text-ink transition-all duration-fast hover:-translate-y-px hover:border-attest/40"
          >
            See the ledger
          </a>
        </div>
      </div>

      {/* Live verification rail panel */}
      <div className="blur-in relative mx-auto w-full max-w-5xl px-6 pt-14" style={{ animationDelay: '0.3s' }}>
        <div className="mask-fade-bottom relative overflow-hidden rounded-4xl border border-line bg-panel/80 backdrop-blur-sm">
          <div className="flex flex-col justify-between p-6 font-mono md:p-8">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-mut">
                {live ? 'Latest order · live state' : 'Verification rail · awaiting data'}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-xs text-mut">
                {live && lastOrder ? (
                  <>
                    <span>
                      order <span className="text-ink">{lastOrder.orderId}</span>
                    </span>
                    <span>
                      service <span className="text-ink">{lastOrder.serviceLabel}</span>
                    </span>
                    <span>
                      escrow <span className="text-attest">{lastOrder.escrowStatus}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-attest" />
                      <span className="text-attest">POLLING /api/veil/state</span>
                    </span>
                  </>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-pend" />
                    waiting for the operator to send a purchase
                  </span>
                )}
              </div>
            </div>

            <ul className="mt-6 space-y-2.5">
              {STAGE_SEQUENCE.map((st, i) => {
                const { done, bad, label } = stageState(st.key, stages);
                const last = i === STAGE_SEQUENCE.length - 1;
                return (
                  <li key={st.key} className="relative flex items-center gap-4">
                    {!last && (
                      <span
                        className={`absolute left-[7px] top-7 h-[calc(100%-12px)] w-px ${
                          done ? 'bg-attest/60' : bad ? 'bg-bad/50' : 'bg-line'
                        }`}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`relative flex h-[15px] w-[15px] items-center justify-center rounded-full border ${
                        done
                          ? 'border-attest bg-attest/30'
                          : bad
                            ? 'border-bad bg-bad/30'
                            : 'border-line bg-panel2'
                      }`}
                    >
                      {done && <span className="h-1.5 w-1.5 rounded-full bg-attest" />}
                      {bad && <span className="h-1.5 w-1.5 rounded-full bg-bad" />}
                    </span>
                    <span className={`text-xs uppercase tracking-wider ${bad ? 'text-bad' : done ? 'text-ink' : 'text-mut'}`}>
                      {st.label}
                    </span>
                    <span
                      className={`ml-auto font-mono text-[10px] uppercase tracking-wider ${
                        done ? 'text-attest' : bad ? 'text-bad' : 'text-mut/70'
                      }`}
                    >
                      {done ? '✓ verified' : bad ? '✕ refused' : label}
                    </span>
                  </li>
                );
              })}
            </ul>

            <p className="mt-6 text-[11px] text-mut">
              {state.killSwitch
                ? 'kill switch engaged — future purchases refuse at the gate'
                : `agent ${state.agent.status} · ${state.verifiedTransactions} verified · budget ${state.remainingAtoms === '0' ? '$0.000' : ''} remaining`}
            </p>
          </div>
        </div>
      </div>

      {/* Logo marquee */}
      <div className="relative mx-auto mt-12 w-full max-w-5xl overflow-hidden px-6 pb-16 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
        <div className="animate-marquee flex w-max">
          {[0, 1].map((copy) => (
            <ul key={copy} className="flex items-center" aria-hidden={copy === 1}>
              {MARQUEE.map((name) => (
                <li key={`${copy}-${name}`} className="mx-8 flex-none">
                  <span className="whitespace-nowrap font-mono text-sm font-medium uppercase tracking-widest text-mut/80">
                    {name}
                  </span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}
