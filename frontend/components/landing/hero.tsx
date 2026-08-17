'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { STAGE_NODE_INDEX } from '../../lib/veil-client';
import { useLive } from './use-live';

const RAIL = [
  { id: 'USER', hint: 'mandate' },
  { id: 'AI AGENT', hint: 'plans with 7 tools' },
  { id: 'PAYMENT', hint: 'x402 escrow' },
  { id: 'ATTESTCOIN', hint: 'cross-chain proof' },
  { id: 'CREDITCOIN', hint: 'operator settles' },
  { id: 'AUDIT', hint: 'sealed register' },
] as const;

export function Hero(): React.ReactElement {
  const { lastOrder, live, state } = useLive();
  const reduce = useReducedMotion();

  const reach = (() => {
    if (!lastOrder) return -1;
    let furthest = -1;
    for (const st of lastOrder.stages) {
      if (st.status === 'VERIFIED' || st.status === 'SETTLED') {
        furthest = Math.max(furthest, STAGE_NODE_INDEX[st.key] ?? -1);
      }
    }
    return furthest;
  })();

  const toRailIndex = (() => {
    // USER->AGENT->PAYMENT->ATTESTCOIN->CREDITCOIN->AUDIT mapped from pipeline node index
    const map: Record<number, number> = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 7: 5 };
    return map[reach] ?? -1;
  })();

  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(60% 50% at 20% 0%, rgba(56,189,248,0.10) 0%, transparent 60%), radial-gradient(50% 40% at 85% 100%, rgba(56,189,248,0.06) 0%, transparent 60%)',
        }}
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 md:py-28 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <motion.div
          initial={reduce ? undefined : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="eyebrow">Verifiable Economic Infrastructure</p>
          <h1 className="mt-5 max-w-xl text-4xl font-semibold leading-[1.08] tracking-tight text-ink md:text-6xl">
            Agents act.
            <br />
            You verify.
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-mut md:text-lg">
            VEIL gives autonomous agents an escrowed, cross-chain-attested payment rail with selective audit and a kill
            switch. Every dollar is verifiable, every mandate revocable.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/app"
              className="inline-flex items-center gap-2 rounded-control border border-attest/40 bg-attest/10 px-5 py-2.5 text-sm font-medium text-attest transition-colors hover:bg-attest/20"
            >
              Launch VEIL
            </Link>
            <a
              href="#architecture"
              className="inline-flex items-center gap-2 rounded-control border border-line bg-panel2 px-5 py-2.5 text-sm font-medium text-mut transition-colors hover:text-ink"
            >
              Explore the Architecture
            </a>
          </div>
          <p className="mt-8 font-mono text-[11px] uppercase tracking-wider text-mut">
            live mirror state · not a rendering
          </p>
        </motion.div>

        <motion.div
          initial={reduce ? undefined : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          aria-label="VEIL verification rail preview"
        >
          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <span className="font-mono text-xs uppercase tracking-wider text-mut">verification rail</span>
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-pend">
                <span className="h-1.5 w-1.5 rounded-full bg-pend" />
                TESTNET DEMO
              </span>
            </div>
            <ol className="px-5 py-6">
              {RAIL.map((node, i) => {
                const done = toRailIndex >= i;
                const active = toRailIndex === i - 1;
                const blocked = state.killSwitch;
                return (
                  <li key={node.id} className="relative flex items-start gap-4 pb-5 last:pb-0">
                    {i < RAIL.length - 1 && (
                      <span
                        className={`absolute left-[13px] top-8 h-[calc(100%-20px)] w-px ${
                          done || active ? 'bg-attest/40' : 'bg-line'
                        }`}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`mt-0.5 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full border font-mono text-[10px] transition-colors ${
                        done
                          ? 'border-attest/50 bg-attest/15 text-attest'
                          : active
                            ? 'border-attest/40 bg-attest/10 text-attest animate-pulse'
                            : 'border-line bg-panel2 text-mut'
                      }`}
                    >
                      {done ? '✓' : i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-sm font-medium ${done ? 'text-ink' : 'text-mut'}`}>{node.id}</span>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-mut">{node.hint}</span>
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-mut">
                        {blocked
                          ? 'halted by operator'
                          : done
                            ? 'verified'
                            : active
                              ? 'in flight'
                              : 'waiting'}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="border-t border-line px-5 py-3 font-mono text-[11px] text-mut">
              {!live
                ? 'awaiting first purchase'
                : `tracking ${lastOrder?.orderId ?? '…'} · ${state.verifiedTransactions} verified`}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}