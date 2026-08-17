'use client';

import Link from 'next/link';
import { ArrowRight } from '@phosphor-icons/react';
import { Reveal } from './reveal';

export function Cta(): React.ReactElement {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
      <Reveal>
        <div className="relative overflow-hidden rounded-card border border-attest/30 bg-panel p-10 text-center md:p-16">
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
            style={{
              background: 'radial-gradient(60% 80% at 50% 0%, rgba(56,189,248,0.10) 0%, transparent 70%)',
            }}
          />
          <p className="eyebrow">Built for BUIDL CTC</p>
          <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-semibold tracking-tight text-ink md:text-5xl">
            Give your agents a rail you can verify.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-mut">
            Open the live console to drive the agent, watch escrow settle, open the vault and pull the kill switch.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/app"
              className="inline-flex items-center gap-2 rounded-control border border-attest/40 bg-attest/10 px-6 py-3 text-sm font-medium text-attest transition-colors hover:bg-attest/20"
            >
              Launch VEIL
              <ArrowRight size={16} weight="regular" />
            </Link>
            <a
              href="#architecture"
              className="inline-flex items-center gap-2 rounded-control border border-line bg-panel2 px-6 py-3 text-sm font-medium text-mut transition-colors hover:text-ink"
            >
              Explore the Architecture
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}