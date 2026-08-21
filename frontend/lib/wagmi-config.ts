import { http, createConfig } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

/** Creditcoin CC3 Testnet (settlement chain) */
export const cc3 = {
  id: 102031,
  name: 'Creditcoin CC3',
  nativeCurrency: { name: 'CTC', symbol: 'CTC', decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_CC3_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: 'https://blockscout.cc3-testnet.creditcoin.network',
    },
  },
} as const;

export const config = createConfig({
  chains: [sepolia, cc3],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(),
    [cc3.id]: http(),
  },
});
