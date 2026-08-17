'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

const LINKS = [
  { href: '#problem', label: 'Problem' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#live-flow', label: 'Live flow' },
  { href: '#architecture', label: 'Architecture' },
  { href: '#security', label: 'Control' },
] as const;

export function Nav(): React.ReactElement {
  const [scrolled, setScrolled] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-colors duration-fast ${
        scrolled ? 'border-line bg-bg/85 backdrop-blur-md' : 'border-transparent bg-transparent'
      }`}
    >
      <motion.div
        className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4"
        initial={reduce ? undefined : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-attest/40 bg-attest/10 font-mono text-sm text-attest">
            V
          </span>
          <span className="font-mono text-sm font-semibold tracking-[0.2em] text-ink">VEIL</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Landing">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-sm text-mut transition-colors hover:text-ink">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1.5 rounded-full border border-pend/40 bg-pend/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-pend sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-pend" />
            TESTNET DEMO
          </span>
          <Link
            href="/app"
            className="inline-flex items-center gap-2 rounded-control border border-attest/40 bg-attest/10 px-4 py-2 text-sm font-medium text-attest transition-colors hover:bg-attest/20"
          >
            Launch VEIL
          </Link>
        </div>
      </motion.div>
    </header>
  );
}