'use client';

import { useState } from 'react';
import { Eye, EyeSlash, LockSimple, FolderLock } from '@phosphor-icons/react';
import { Reveal } from './reveal';

export function Privacy(): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <section id="privacy" className="mx-auto max-w-6xl px-6 py-20 md:py-28">
      <Reveal>
        <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-ink md:text-4xl">
          The register is public. The details are sealed.
        </h2>
      </Reveal>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <Reveal>
          <div className="h-full rounded-card border border-line bg-panel p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-control border border-line bg-panel2">
                <LockSimple size={18} weight="regular" className="text-mut" />
              </span>
              <div>
                <h3 className="text-lg font-semibold text-ink">Public register</h3>
                <p className="text-xs text-mut">everyone</p>
              </div>
            </div>
            <ul className="mt-6 space-y-2 text-sm text-mut">
              <li className="flex justify-between gap-2 border-b border-line/40 pb-2">
                <span>tx id</span>
                <span className="font-mono text-attest">veil-current</span>
              </li>
              <li className="flex justify-between gap-2 border-b border-line/40 pb-2">
                <span>commitment</span>
                <span className="font-mono text-attest">keccak sealed</span>
              </li>
              <li className="flex justify-between gap-2 border-b border-line/40 pb-2">
                <span>verification</span>
                <span className="font-mono text-ok">verified</span>
              </li>
              <li className="flex justify-between gap-2">
                <span>amount</span>
                <span className="font-mono text-mut">(sealed)</span>
              </li>
            </ul>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="flex h-full flex-col rounded-card border border-line bg-panel p-7">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-control border border-attest/40 bg-attest/10">
                <FolderLock size={18} weight="regular" className="text-attest" />
              </span>
              <div>
                <h3 className="text-lg font-semibold text-ink">Auditor view</h3>
                <p className="text-xs text-mut">signed AuditAccess only</p>
              </div>
            </div>

            <dl className="mt-6 flex-1 space-y-2 text-sm" role="group" aria-label="Sealed fields">
              {[
                ['amount', open ? '0.040 USD' : '••••••'],
                ['service', open ? 'Market Data Feed' : '••••••'],
                ['provider', open ? '0x44…4444' : '••••••'],
                ['request hash', open ? 'sha256:9c1…2a8e' : '••••••'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between border-b border-line/40 pb-2 last:border-0">
                  <dt className="text-mut">{k}</dt>
                  <dd className={`font-mono ${open ? 'text-ink' : 'text-mut'}`}>
                    {open ? v : '•'.repeat(8)}
                  </dd>
                </div>
              ))}
            </dl>

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className={`mt-6 inline-flex items-center justify-center gap-2 rounded-control border px-4 py-2.5 text-sm font-medium transition-colors ${
                open
                  ? 'border-line bg-panel2 text-mut hover:text-ink'
                  : 'border-attest/40 bg-attest/10 text-attest hover:bg-attest/20'
              }`}
              aria-expanded={open}
            >
              {open ? <EyeSlash size={16} weight="regular" /> : <Eye size={16} weight="regular" />}
              {open ? 'Seal again' : 'Open as auditor'}
            </button>
            <p className="mt-3 text-[11px] leading-relaxed text-mut">
              Decryption only succeeds when the signed AuditAccess recovers to an authorized auditor address.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}