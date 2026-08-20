import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Lora } from 'next/font/google';
import { SiteFrame } from '../components/site-frame';
import './globals.css';

const lora = Lora({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-lora',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'VEIL | Verifiable Economic Infrastructure Layer',
  description:
    'VEIL gives autonomous agents an escrowed, cross-chain-attested payment rail with selective audit and a kill switch. Agents act, you verify.',
  applicationName: 'VEIL',
  keywords: ['AI agents', 'Attestcoin', 'Creditcoin', 'escrow', 'verification', 'BUIDL'],
  metadataBase: new URL('https://github.com/bayuapriansyah/Veil'),
  openGraph: {
    title: 'VEIL | Verifiable Economic Infrastructure Layer',
    description:
      'An escrowed, cross-chain-attested payment rail for autonomous agents. Agents act, you verify.',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'VEIL | Verifiable Economic Infrastructure Layer',
    description: 'An escrowed, cross-chain-attested payment rail for autonomous agents.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${lora.variable}`}
    >
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:border focus:border-attest/50 focus:bg-bg focus:px-4 focus:py-2 focus:text-sm focus:text-ink"
        >
          Skip to content
        </a>
        <SiteFrame />
        {children}
      </body>
    </html>
  );
}
