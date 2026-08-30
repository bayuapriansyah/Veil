'use client';

import { useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import { api, VeilState, atomsUsd, useVeilMode, shortAddress } from '../lib/veil-client';
import { Card, StatusChip } from './ui';

const DIRECT_SUGGESTED = ['Buy one unit of live market data for my trading dashboard', 'Purchase a market data feed (one call)'];
const DELEGATE_SUGGESTED = ['Delegate market data purchase to Agent B', 'Have Agent B buy compute rental', 'Ask Agent B to purchase storage access'];

interface DelegateResult {
  ok: boolean;
  orderId?: string;
  reason?: string;
  delegation?: {
    bToCPaymentTx?: string;
    aToBFulfillmentTx?: string;
    provider?: string;
    bToCPaymentRecorded?: boolean;
    aToBFulfillmentRecorded?: boolean;
  };
}

export function PurchaseConsole({ onResult }: { onResult?: (msg: { ok: boolean; text: string }) => void }): React.ReactElement {
  const [tab, setTab] = useState<'direct' | 'delegate'>('direct');
  const [task, setTask] = useState(DIRECT_SUGGESTED[0]);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ ok: boolean; orderId?: string; reason?: string; onchainRecordTxHash?: string | null; fulfillmentTxHash?: string | null } | null>(null);
  const [lastDelegate, setLastDelegate] = useState<DelegateResult | null>(null);
  const mode = useVeilMode();

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const body = await api<{ ok: boolean; orderId?: string; reason?: string; onchainRecordTxHash?: string | null; fulfillmentTxHash?: string | null }>('/api/veil/purchase', {
        method: 'POST',
        body: JSON.stringify({ task }),
      });
      setLast(body);
      onResult?.({
        ok: body.ok,
        text: body.ok
          ? `Order ${body.orderId} settled through the rail.` + (body.onchainRecordTxHash ? ` AgentPayment on-chain: ${body.onchainRecordTxHash.slice(0, 10)}…${body.onchainRecordTxHash.slice(-6)}` : '')
          : `Refused: ${body.reason}`,
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      setLast({ ok: false, reason: err });
      onResult?.({ ok: false, text: err });
    } finally {
      setBusy(false);
    }
  };

  const delegate = async (): Promise<void> => {
    setBusy(true);
    try {
      const body = await api<DelegateResult>('/api/veil/delegate', {
        method: 'POST',
        body: JSON.stringify({ task }),
      });
      setLastDelegate(body);
      onResult?.({
        ok: body.ok,
        text: body.ok
          ? `Delegated to Agent B. Order ${body.orderId}.` + (body.delegation?.bToCPaymentTx ? ` B→C payment: ${body.delegation.bToCPaymentTx.slice(0, 10)}…` : '')
          : `Delegation failed: ${body.reason}`,
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      setLastDelegate({ ok: false, reason: err });
      onResult?.({ ok: false, text: err });
    } finally {
      setBusy(false);
    }
  };

  const switchTab = (newTab: 'direct' | 'delegate'): void => {
    setTab(newTab);
    setTask(newTab === 'direct' ? DIRECT_SUGGESTED[0] : DELEGATE_SUGGESTED[0]);
    setLast(null);
    setLastDelegate(null);
  };

  const suggested = tab === 'direct' ? DIRECT_SUGGESTED : DELEGATE_SUGGESTED;

  return (
    <Card title="Purchase Console" right={<span className="font-mono text-[11px] text-mut">{tab === 'direct' ? '8 tools · mandate-gated' : 'A2A delegation'}</span>}>
      <div className="flex flex-col gap-4">
        {mode === 'production' && (
          <div className="flex items-center gap-2 rounded-lg border border-bad/30 bg-bad/5 px-4 py-2.5">
            <Warning size={14} className="shrink-0 text-bad" />
            <span className="text-xs text-bad/80">Live mode — real CTC gas fees apply on Sepolia + CC3</span>
          </div>
        )}

        {/* Tab buttons */}
        <div className="flex gap-1 rounded-lg border border-line bg-panel2/40 p-1">
          <button
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${tab === 'direct' ? 'bg-ok/10 text-ok' : 'text-mut hover:text-ink'}`}
            onClick={() => switchTab('direct')}
          >
            Direct
          </button>
          <button
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${tab === 'delegate' ? 'bg-ok/10 text-ok' : 'text-mut hover:text-ink'}`}
            onClick={() => switchTab('delegate')}
          >
            Delegate to Agent B
          </button>
        </div>

        <textarea
          className="input-dark min-h-[100px] resize-y font-mono text-sm"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder={tab === 'direct' ? 'Describe the purchase you want the agent to make…' : 'Describe the task to delegate to Agent B…'}
        />
        <div className="flex flex-wrap items-center gap-2.5">
          <button className="btn-primary" onClick={() => tab === 'direct' ? void run() : void delegate()} disabled={busy || !task.trim()}>
            {busy ? 'Executing…' : tab === 'direct' ? 'Run purchase' : 'Delegate'}
          </button>
          {suggested.map((s) => (
            <button key={s} className="btn-muted text-[13px]" onClick={() => setTask(s)} disabled={busy}>
              {s.split(' ').slice(0, 4).join(' ') + '…'}
            </button>
          ))}
        </div>

        {/* Direct mode result */}
        {tab === 'direct' && (
          <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-line bg-panel2/60 px-4 py-2.5">
            <StatusChip status={last && !last.ok ? 'REJECTED' : 'PENDING'} label="agent" />
            <span className="font-mono text-[13px] text-mut">
              {last
                ? last.ok
                  ? `ok · order ${last.orderId}`
                  : last.reason
                : 'idle · deterministic planner + 8-tool surface'}
            </span>
          </div>
        )}

        {/* Delegate mode result */}
        {tab === 'delegate' && lastDelegate && (
          <div className="rounded-lg border border-line bg-panel2/60 p-4">
            <div className="flex items-center gap-2">
              <StatusChip status={lastDelegate.ok ? 'SETTLED' : 'REJECTED'} label={lastDelegate.ok ? 'DELEGATED' : 'FAILED'} />
              {lastDelegate.ok && lastDelegate.orderId && (
                <span className="font-mono text-[13px] text-ok">order {lastDelegate.orderId}</span>
              )}
            </div>
            {lastDelegate.ok && lastDelegate.delegation && (
              <div className="mt-3 space-y-1.5 text-xs font-mono text-mut">
                {lastDelegate.delegation.provider && (
                  <div className="flex items-center gap-2">
                    <span className="text-ok">Agent B:</span>
                    <span>{shortAddress(lastDelegate.delegation.provider, 6)}</span>
                  </div>
                )}
                {lastDelegate.delegation.bToCPaymentTx && (
                  <div className="flex items-center gap-2">
                    <span className="text-pend">B→C payment:</span>
                    <span className="text-ink">{lastDelegate.delegation.bToCPaymentTx.slice(0, 10)}…{lastDelegate.delegation.bToCPaymentTx.slice(-6)}</span>
                    <span className="text-ok text-[10px]">✓ recorded</span>
                  </div>
                )}
                {lastDelegate.delegation.aToBFulfillmentTx && (
                  <div className="flex items-center gap-2">
                    <span className="text-pend">A→B fulfillment:</span>
                    <span className="text-ink">{lastDelegate.delegation.aToBFulfillmentTx.slice(0, 10)}…{lastDelegate.delegation.aToBFulfillmentTx.slice(-6)}</span>
                    <span className="text-ok text-[10px]">✓ recorded</span>
                  </div>
                )}
              </div>
            )}
            {lastDelegate.reason && (
              <div className="mt-2 text-xs text-bad">{lastDelegate.reason}</div>
            )}
          </div>
        )}

        {/* Delegate mode info */}
        {tab === 'delegate' && !lastDelegate && (
          <div className="rounded-lg border border-line bg-panel2/60 px-4 py-3">
            <span className="font-mono text-[13px] text-mut">
              idle · Agent B discovered from on-chain registry
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}

export function KillSwitch({ state, onDied }: { state: VeilState; onDied?: () => void }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const mode = useVeilMode();
  const engage = async (): Promise<void> => {
    setBusy(true);
    try {
      await api('/api/veil/kill', { method: 'POST', body: '{}' });
      onDied?.();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Kill Switch"
      right={<StatusChip status={state.killSwitch ? 'REJECTED' : 'VERIFIED'} label={state.killSwitch ? 'ENGAGED' : 'ARMED'} />}
    >
      <p className="text-sm leading-relaxed text-mut">
        Revokes every mandate on every provider ledger (mirrors MandateManager revoke) and makes the agent refuse future
        purchases at the gate.
      </p>
      {mode === 'production' && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-bad/30 bg-bad/5 px-3 py-2">
          <Warning size={12} className="shrink-0 text-bad" />
          <span className="text-xs text-bad/80">In production this revokes live on-chain mandates</span>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <button className="btn-danger" onClick={() => void engage()} disabled={busy || state.killSwitch}>
          {state.killSwitch ? 'Engaged · mandates revoked' : busy ? 'Revoking…' : 'Engage kill switch'}
        </button>
      </div>
    </Card>
  );
}

export function BudgetGauge({ budgetAtoms, spentAtoms }: { budgetAtoms: string; spentAtoms: string }): React.ReactElement {
  const total = Number(BigInt(budgetAtoms));
  const used = Number(BigInt(spentAtoms));
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const bar = pct > 85 ? 'bg-bad' : pct > 60 ? 'bg-pend' : 'bg-ok';
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between font-mono text-[13px] text-mut">
        <span>
          spent {atomsUsd(spentAtoms)} / {atomsUsd(budgetAtoms)} USD
        </span>
        <span>{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-panel2">
        <div
          className={`h-full rounded-full transition-all duration-500 ${bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}