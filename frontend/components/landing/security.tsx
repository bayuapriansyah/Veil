'use client';

import { useState } from 'react';
import { LockKey, LockSimple, Power, ShieldCheck } from '@phosphor-icons/react';
import { api } from '../../lib/veil-client';
import { useLive } from './use-live';
import { Reveal } from './reveal';

export function Security(): React.ReactElement {
  const { state } = useLive(3000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const engaged = state.killSwitch;

  const engage = async (): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      await api('/api/veil/kill', { method: 'POST', body: '{}' });
      setMsg('Kill switch engaged. Every mandate revoked on every provider ledger.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="security" className="mx-auto max-w-6xl px-6 py-20 md:py-28">
      <Reveal>
        <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-ink md:text-4xl">
          The operator keeps the last word.
        </h2>
      </Reveal>

      <div className="mt-12 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Reveal>
          <div className="h-full rounded-card border border-line bg-panel p-7">
            <div className="flex items-center gap-3">
              <span className={`flex h-12 w-12 items-center justify-center rounded-control border ${
                engaged ? 'border-bad/50 bg-bad/15' : 'border-ok/40 bg-ok/10'
              }`}>
                {engaged
                  ? <Power size={22} weight="regular" className="text-bad" />
                  : <Power size={22} weight="regular" className="text-ok" />}
              </span>
              <div>
                <div className="font-mono text-xl font-semibold text-ink">{engaged ? 'ENGAGED' : 'ARMED'}</div>
                <p className="text-xs text-mut">kill switch · {engaged ? 'all mandates revoked' : 'ready to revoke'}</p>
              </div>
            </div>

            <p className="mt-6 text-sm leading-relaxed text-mut">
              The kill switch mirrors MandateManager revoke across every provider ledger. Once engaged, the agent
              refuses all future purchases at the gate and the dashboards flip to KILLED state immediately.
            </p>

            <button
              type="button"
              onClick={() => void engage()}
              disabled={busy || engaged}
              className={`mt-6 inline-flex w-full items-center justify-center gap-2 rounded-control border px-4 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                engaged ? 'border-line bg-panel2 text-mut' : 'border-bad/40 bg-bad/10 text-bad hover:bg-bad/20'
              }`}
            >
              <Power size={16} weight="regular" />
              {engaged ? 'Kill switch engaged' : busy ? 'Revoking…' : 'Engage kill switch'}
            </button>
            {msg && (
              <p className={`mt-3 rounded-md border px-3 py-2 text-xs ${
                engaged ? 'border-bad/30 bg-bad/10 text-bad' : 'border-line bg-panel2 text-mut'
              }`}>
                {msg}
              </p>
            )}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="grid h-full grid-rows-3 gap-3">
            {[
              {
                icon: ShieldCheck,
                title: 'Party-bound escrow',
                body: 'Settlement refuses unless the payer and the provider are exactly the attested parties.',
              },
              {
                icon: LockSimple,
                title: 'Sealed by default',
                body: 'Evidence never leaves the vault unsealed. Only signed AuditAccess opens it.',
              },
              {
                icon: LockKey,
                title: 'Admin-gated controls',
                body: 'Kill, authorize and revoke require an admin token over a guarded API route.',
              },
            ].map((it) => (
              <div key={it.title} className="flex items-start gap-4 rounded-panel border border-line bg-panel p-5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-line bg-panel2">
                  <it.icon size={16} weight="regular" className="text-attest" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-ink">{it.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-mut">{it.body}</p>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}