import Link from 'next/link';

const LINKS = [
  { href: '#problem', label: 'Problem' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#architecture', label: 'Architecture' },
  { href: '#security', label: 'Control' },
] as const;

export function Footer(): React.ReactElement {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-6 py-12 md:flex-row md:items-center">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-attest/40 bg-attest/10 font-mono text-sm text-attest">
            V
          </span>
          <div>
            <div className="font-mono text-sm font-semibold tracking-[0.2em] text-ink">VEIL</div>
            <div className="text-[10px] uppercase tracking-wider text-mut">Verifiable Economic Infrastructure Layer</div>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-6" aria-label="Footer">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-sm text-mut transition-colors hover:text-ink">
              {l.label}
            </a>
          ))}
          <Link href="/app" className="text-sm text-attest transition-colors hover:text-attest/80">
            Launch console
          </Link>
        </nav>

        <div className="text-xs text-mut">
          <div className="font-mono uppercase tracking-wider">BUIDL CTC 2026 · Fall</div>
          <div className="mt-1">Attestcoin + Creditcoin, demo mirror</div>
        </div>
      </div>
    </footer>
  );
}