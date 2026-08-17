'use client';

import { OrderDetail, VeilState } from '../../lib/veil-client';
import { usePoll } from '../../lib/use-poll';

export const EMPTY_STATE: VeilState = {
  agent: { address: '', status: 'active' },
  killSwitch: false,
  budgetAtoms: '0',
  spentAtoms: '0',
  remainingAtoms: '0',
  reservedAtoms: '0',
  reputation: { provider: '', score: 0, reviews: 0 },
  verifiedTransactions: 0,
  transactionCount: 0,
  currentMandate: null,
  providersCount: 0,
  orderIds: [],
  keySource: '',
  txsAtoms: '0',
};

export interface LiveData {
  state: VeilState;
  orders: OrderDetail[];
  lastOrder: OrderDetail | null;
  live: boolean;
}

export function useLive(intervalMs = 2500): LiveData {
  const { data } = usePoll<{ ok: boolean; state: VeilState }>('/api/veil/state', { ok: true, state: EMPTY_STATE }, intervalMs);
  const { data: ordersData } = usePoll<{ ok: boolean; orders: OrderDetail[] }>(
    '/api/veil/orders',
    { ok: true, orders: [] },
    intervalMs,
  );
  const state = data.state ?? EMPTY_STATE;
  const orders = ordersData.orders ?? [];
  return {
    state,
    orders,
    lastOrder: orders[0] ?? null,
    live: orders.length > 0,
  };
}