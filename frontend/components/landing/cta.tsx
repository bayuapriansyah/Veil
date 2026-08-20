'use client';

import Link from 'next/link';
import { ArrowDownRight } from '@phosphor-icons/react';

export function Cta(): React.ReactElement {
  return (
    <section className="relative overflow-hidden border-t border-line px-6 py-28 md:py-36">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(55% 60% at 50% 100%, rgba(70,199,135,0.12) 0%, transparent 70%)',
        }}
      />
      <div className="relative mx-auto max-w-3xl text-center">
        <h2 className="text-5xl font-medium leading-[1.08] tracking-tight text-ink sm:text-6xl">
          Give your agents a rail <em className="font-serif italic text-attest">you</em> can verify.
        </h2>
        <p className="blur-in mx-auto mt-7 max-w-xl text-lg leading-relaxed text-mut">
          Open the live console to drive the agent, watch escrow settle, open the vault and pull the
          kill switch.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
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
            href="https://github.com/bayuapriansyah/Veil"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-2xl border border-line bg-panel px-6 py-3 text-sm font-medium text-ink transition-all duration-fast hover:-translate-y-px hover:border-attest/40"
          >
            Read the architecture
          </a>
        </div>
      </div>
    </section>
  );
}
