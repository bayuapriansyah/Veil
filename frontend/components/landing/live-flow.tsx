'use client';

import { STAGE_SEQUENCE, TimelineStage } from '../../lib/veil-client';
import { useLive } from './use-live';
import { Reveal } from './reveal';

export function LiveVerificationFlow(): React.ReactElement {
  const { lastOrder, live } = useLive(2000);
  const stages = lastOrder?.stages ?? [];

  const stageStatusFor = (key: string): { done: boolean; bad: boolean; status: string } => {
    const st = stages.find((s: TimelineStage) => s.key === key);
    if (!st) return { done: false, bad: false, status: 'PENDING' };
    const done = st.status === 'VERIFIED' || st.status === 'SETTLED';
    const bad = st.status === 'FAILED' || st.status === 'REJECTED' || st.status === 'REFUNDED';
    return { done, bad, status: st.status };
  };

  return (
    <section id="live-flow" className="border-y border-line bg-paper">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <Reveal>
            <p className="eyebrow">Live verification flow</p>
            <h2 className="mt-4 max-w-md text-3xl font-semibold tracking-tight text-ink md:text-4xl">
              Watch proof move, one stage at a time.
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-mut">
              This is the real state machine of the latest order on the demo rail, polled live. Nothing here advances
              past a stage the ledger has not actually reached.
            </p>

            <div className="mt-8 rounded-card border border-line bg-panel p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs uppercase tracking-wider text-mut">latest order</span>
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-pend">
                  <span className="h-1.5 w-1.5 rounded-full bg-pend" />
                  TESTNET DEMO
                </span>
              </div>
              <div className="mt-4 font-mono text-xl text-ink">
                {live ? lastOrder?.orderId ?? '…' : 'awaiting first order'}
              </div>
              {live && lastOrder && (
                <div className="mt-2 space-y-1.5 text-xs text-mut">
                  <div className="flex justify-between gap-2">
                    <span>service</span>
                    <span className="font-mono text-ink">{lastOrder.serviceLabel}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>amount</span>
                    <span className="font-mono text-ink">{lastOrder.amountAtoms} atoms</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>escrow</span>
                    <span className="font-mono text-ink">{lastOrder.escrowStatus}</span>
                  </div>
                </div>
              )}
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="rounded-card border border-line bg-panel p-7">
              <ol>
                {STAGE_SEQUENCE.map((st, i) => {
                  const { done, bad, status } = stageStatusFor(st.key);
                  const last = i === STAGE_SEQUENCE.length - 1;
                  return (
                    <li key={st.key} className="relative flex gap-4 pb-6 last:pb-0">
                      {!last && (
                        <span
                          className={`absolute left-[13px] top-8 h-[calc(100%-20px)] w-px ${
                            done ? 'bg-ok/50' : bad ? 'bg-bad/50' : 'bg-line'
                          }`}
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className={`relative mt-0.5 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full border font-mono text-[10px] ${
                          done
                            ? 'border-ok bg-ok/15 text-ok'
                            : bad
                              ? 'border-bad bg-bad/15 text-bad'
                              : 'border-line bg-panel2 text-mut'
                        }`}
                      >
                        {done ? '✓' : bad ? '✕' : i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-sm font-medium ${bad ? 'text-bad' : 'text-ink'}`}>{st.label}</span>
                          <span
                            className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                              done
                                ? 'border-ok/40 bg-ok/10 text-ok'
                                : bad
                                  ? 'border-bad/40 bg-bad/10 text-bad'
                                  : 'border-line bg-panel2 text-mut'
                            }`}
                          >
                            {status}
                          </span>
                        </div>
                        {!live && i === 0 && <p className="mt-1 text-xs text-mut">Waiting for the operator to send a purchase.</p>}
                        {live && bad && <p className="mt-1 text-xs text-bad">{lastOrder?.error ?? 'Refused at gate.'}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}