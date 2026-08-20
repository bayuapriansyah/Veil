'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { LockKey, Receipt, Scissors } from '@phosphor-icons/react';
import { useLive } from './use-live';
import { api } from '../../lib/veil-client';

export function Features(): React.ReactElement {
  const { state } = useLive(3000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const revoked = state.killSwitch;

  const engage = async (): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      await api('/api/veil/kill', { method: 'POST', body: '{}' });
      setMsg('Mandate revoked. Transactions blocked.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="how-it-works" className="relative px-6 py-24 md:py-32">
      <div className="mx-auto max-w-5xl">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1.5fr]">
          {/* Escrow — tall left card */}
          <motion.div
            className="group flex min-h-[420px] flex-col overflow-hidden rounded-4xl border border-line bg-panel p-8"
            initial={reduce ? undefined : { opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="relative z-10 text-center transition-transform duration-500 group-hover:scale-[1.03]">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-attest/30 bg-attest/10">
                <LockKey size={20} weight="regular" className="text-attest" />
              </span>
              <h3 className="mt-4 text-3xl font-medium leading-tight text-ink">Escrow, not advance</h3>
              <p className="mt-3 text-sm leading-relaxed text-mut">
                The agent shops through tools, never keys. Payment locks in escrow and releases only
                on verified proof.
              </p>
            </div>
            <div className="flex flex-1 items-end justify-center">
              <div className="relative flex h-64 w-44 flex-col overflow-hidden rounded-t-4xl border-4 border-b-0 border-line bg-panel2 pt-6">
                <div className="absolute left-1/2 top-2 h-5 w-20 -translate-x-1/2 rounded-full bg-line" aria-hidden="true" />
                <div className="px-5 pt-8">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-mut">escrow</div>
                  <div className="mt-1 text-2xl font-medium tracking-tight text-ink">
                    {state.reservedAtoms === '0' ? '$0.000' : `$${Number(BigInt(state.reservedAtoms)) / 1e18}`}
                  </div>
                  <div className="mt-4 rounded-2xl bg-gradient-to-br from-attest to-attest/40 p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-xs font-semibold text-bg">STATUS</div>
                        <div className="text-xs font-semibold text-bg">
                          {revoked ? 'REVOKED' : state.agent.status === 'active' ? 'LOCKED' : 'HALTED'}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-[10px] tracking-widest text-bg/80">
                      <span>RELEASE</span>
                      <span>·</span>
                      <span>ON</span>
                      <span>·</span>
                      <span>PROOF</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Receipts — wide right card */}
          <motion.div
            className="group relative flex min-h-[420px] flex-col overflow-hidden rounded-4xl border border-line bg-panel p-8"
            initial={reduce ? undefined : { opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="relative z-10 max-w-xs transition-transform duration-500 group-hover:scale-[1.03]">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-attest/30 bg-attest/10">
                <Receipt size={20} weight="regular" className="text-attest" />
              </span>
              <h3 className="mt-4 text-2xl font-medium leading-tight text-ink">Receipts anchored on chain</h3>
              <p className="mt-3 text-sm leading-relaxed text-mut">
                Every decision is hashed, batched, and committed to the ledger. The public register
                carries the facts; the evidence stays sealed.
              </p>
            </div>
            <div className="relative mt-8">
              <div className="absolute -top-10 right-0 size-56 rounded-full border border-attest/20" aria-hidden="true" />
              <div className="absolute -top-16 right-8 size-72 rounded-full border border-attest/15" aria-hidden="true" />
              <div className="absolute -top-24 right-16 size-88 rounded-full border border-attest/10" aria-hidden="true" />
              <div className="relative z-10 overflow-hidden rounded-3xl border-4 border-line bg-bg">
                <div className="border-b border-line px-5 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-mut">public register</div>
                </div>
                <dl className="space-y-0.5 px-5 py-4 font-mono text-[11px]">
                  {[
                    ['tx id', 'veil-current'],
                    ['commitment', 'keccak sealed'],
                    ['verification', 'verified'],
                    ['amount', '(sealed)'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2 border-b border-line/40 pb-1.5 last:border-0">
                      <dt className="text-mut">{k}</dt>
                      <dd className={v === '(sealed)' ? 'text-mut/60' : 'text-attest'}>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </motion.div>

          {/* Kill switch — full-width card */}
          <motion.div
            id="control"
            className="group relative flex min-h-[280px] flex-col justify-between overflow-hidden rounded-4xl border border-line bg-panel p-8 md:col-span-2"
            initial={reduce ? undefined : { opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
              <div className="max-w-md">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-bad/30 bg-bad/10">
                  <Scissors size={20} weight="regular" className="text-bad" />
                </span>
                <h3 className="mt-4 text-2xl font-medium leading-tight text-ink">Human at the kill switch</h3>
                <p className="mt-3 text-sm leading-relaxed text-mut">
                  One revoke refuses every future purchase on every provider ledger, at the gate —
                  before the transaction exists.
                </p>
              </div>

              <div className="w-full md:w-[340px]">
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line">
                  {[
                    ['AGENT', revoked ? 'REVOKED' : state.agent.status === 'active' ? 'ACTIVE' : 'HALTED'],
                    ['BUDGET', `$${Number(BigInt(state.remainingAtoms || '0')) / 1e18}`],
                  ].map(([l, v]) => (
                    <div key={l} className="bg-panel p-5">
                      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-mut">{l}</div>
                      <div className={`mt-2 text-xl font-semibold ${revoked ? 'text-bad' : 'text-ink'}`}>{v}</div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => void engage()}
                  disabled={busy || revoked}
                  className="mt-4 w-full rounded-2xl border border-bad/40 bg-bad/10 py-4 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-bad transition-all duration-fast hover:bg-bad/20 active:scale-[0.99] disabled:opacity-50"
                >
                  {revoked ? 'Agent revoked' : busy ? 'Revoking…' : 'Revoke agent'}
                </button>
                {msg && <p className="mt-3 text-center font-mono text-[10px] text-mut">{msg}</p>}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
