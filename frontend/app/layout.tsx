import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'VEIL | Verifiable Economic Infrastructure Layer',
  description:
    'VEIL gives autonomous agents an escrowed, cross-chain-attested payment rail with selective audit and a kill switch. Agents act, you verify.',
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="flex min-h-screen flex-col">{children}</body>
    </html>
  );
}