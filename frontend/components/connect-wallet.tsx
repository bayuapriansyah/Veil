'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { Wallet } from '@phosphor-icons/react';

export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <button
        className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-[11px] text-mut transition-colors hover:border-ok/40 hover:text-ink"
        disabled
      >
        <Wallet size={14} weight="regular" />
        Connect Wallet
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-[11px] text-mut transition-colors hover:border-ok/40 hover:text-ink"
        title="Disconnect wallet"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-ok" />
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
    );
  }

  return (
    <button
      onClick={() => connect({ connector: connectors[0] })}
      className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-[11px] text-mut transition-colors hover:border-ok/40 hover:text-ink"
    >
      <Wallet size={14} weight="regular" />
      Connect Wallet
    </button>
  );
}
