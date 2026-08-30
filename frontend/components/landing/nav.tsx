'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowDownRight, List, X } from '@phosphor-icons/react';

const LINKS = [
  { href: '#ledger', label: 'Ledger' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#control', label: 'Control' },
] as const;

export function Nav(): React.ReactElement {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    if (open) {
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, [open]);

  const LaunchButton = (
    <Link href="/app" className="group relative inline-flex items-center">
      <span className="absolute right-0 inset-y-0 w-[calc(100%-1.75rem)] rounded-2xl bg-attest/90" />
      <span className="relative z-10 rounded-2xl bg-ink px-5 py-2.5 text-sm font-medium text-bg transition-colors hover:bg-white">
        Launch VEIL
      </span>
      <span className="relative -left-px z-10 flex h-10 w-10 items-center justify-center rounded-2xl text-bg">
        <ArrowDownRight
          size={18}
          weight="bold"
          className="transition-transform duration-300 group-hover:-rotate-45"
        />
      </span>
    </Link>
  );

  return (
    <header className="fixed left-1/2 top-2.5 z-50 w-full max-w-5xl -translate-x-1/2 px-4">
      <motion.div
        initial={reduce ? undefined : { opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className={`flex items-center justify-between gap-3 rounded-3xl border px-3 py-2.5 backdrop-blur-xl transition-all duration-base ${
          scrolled
            ? 'border-line bg-bg/85 shadow-[0_16px_40px_-20px_rgba(0,0,0,0.6)]'
            : 'border-line/70 bg-bg/60'
        }`}
      >
        <Link href="/" className="flex items-center gap-2.5 pl-2" onClick={() => setOpen(false)}>
          <Image src="/logo.jpg" alt="VEIL" width={100} height={28} className="h-7 w-auto object-contain" priority />
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Landing">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-full px-4 py-2 text-sm font-medium text-mut transition-colors hover:bg-panel2 hover:text-ink"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href="https://github.com/bayuapriansyah/Veil"
            target="_blank"
            rel="noreferrer"
            className="hidden text-sm font-medium text-mut transition-colors hover:text-ink sm:block"
          >
            GitHub
          </a>
          <div className="hidden md:block">{LaunchButton}</div>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-line bg-panel text-mut transition-colors hover:text-ink md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
          >
            {open ? <X size={18} weight="bold" /> : <List size={18} weight="bold" />}
          </button>
        </div>
      </motion.div>

      <motion.div
        initial={reduce ? undefined : { opacity: 0, y: -8 }}
        animate={{ opacity: open ? 1 : 0, y: open ? 0 : -8 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className={`absolute left-4 right-4 top-[60px] overflow-hidden rounded-3xl border bg-bg/95 backdrop-blur-xl md:hidden ${
          open ? 'pointer-events-auto border-line' : 'pointer-events-none border-transparent'
        }`}
        aria-hidden={!open}
      >
        <div className="flex flex-col p-2">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="rounded-2xl px-4 py-3 text-sm font-medium text-mut transition-colors hover:bg-panel2 hover:text-ink"
            >
              {l.label}
            </a>
          ))}
          <div className="mt-1 border-t border-line/70 pt-2">
            <a
              href="https://github.com/bayuapriansyah/Veil"
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="block rounded-2xl px-4 py-3 text-sm font-medium text-mut transition-colors hover:bg-panel2 hover:text-ink"
            >
              GitHub
            </a>
          </div>
          <div className="p-2" onClick={() => setOpen(false)}>
            {LaunchButton}
          </div>
        </div>
      </motion.div>
    </header>
  );
}