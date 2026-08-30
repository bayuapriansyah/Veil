'use client';

import { useState, useEffect } from 'react';
import { Warning } from '@phosphor-icons/react';
import { api, VeilState, atomsUsd, useVeilMode, shortAddress } from '../lib/veil-client';
import { Card, StatusChip } from './ui';
import { ToolProgressPanel } from './tool-progress';
import type { ToolProgress } from '../../services/procurement/types';

const ATTESTATION_WINDOW_MS = 6 * 60 * 1000;

function PurchasePipeline({ order, createdAt }: { order: { ok: boolean; orderId?: string; onchainRecordTxHash?: string | null; fulfillmentTxHash?: string | null; zkProofHash?: string; zkTxHash?: string | null }; createdAt: number }): React.ReactElement {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const rem = Math.max(0, ATTESTATION_WINDOW_MS - (now - createdAt));
  const remMin = Math.floor(rem / 60_000);
  const remSec = Math.floor((rem % 60_000) / 1000);
  const allDone = rem <= 0;

  const steps = [
    { label: 'Authorization', done: true },
    { label: 'Payment', done: !!order.onchainRecordTxHash, href: order.onchainRecordTxHash ? `https://sepolia.etherscan.io/tx/${order.onchainRecordTxHash}` : undefined },
    { label: 'Fulfillment', done: !!order.fulfillmentTxHash, href: order.fulfillmentTxHash ? `https://sepolia.etherscan.io/tx/${order.fulfillmentTxHash}` : undefined },
    { label: 'ZK Receipt', done: !!order.zkProofHash, href: order.zkTxHash ? `https://sepolia.etherscan.io/tx/${order.zkTxHash}` : undefined },
    { label: 'Attestation', done: allDone, pending: !allDone },
    { label: 'Settlement', done: false },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const pct = (doneCount / steps.length) * 100;

  return (
    <div className="rounded-lg border border-attest/30 bg-attest/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink">Pipeline</span>
        {!allDone ? (
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-attest opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-attest" />
            </span>
            <span className="font-mono text-[12px] text-attest">
              {remMin}m {remSec.toString().padStart(2, '0')}s
            </span>
          </div>
        ) : (
          <span className="font-mono text-[12px] text-ok">attested</span>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-panel2">
        <div className="h-full rounded-full bg-attest transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {steps.map((s) => (
          <span key={s.label} className={`font-mono ${s.done ? 'text-ok' : s.pending ? 'text-attest' : 'text-mut/50'}`}>
            {s.done ? '✓' : s.pending ? '◦' : '·'}{' '}
            {s.href ? (
              <a href={s.href} target="_blank" rel="noopener noreferrer" className="underline decoration-current/30 hover:decoration-current/70">
                {s.label}
              </a>
            ) : (
              s.label
            )}
          </span>
        ))}
      </div>
      <p className="mt-2.5 text-[11px] leading-relaxed text-mut">
        Every order enters the same ~6 min attestation window on Creditcoin — no fast track, same cost for all participants.
      </p>
    </div>
  );
}

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
  const [last, setLast] = useState<{ ok: boolean; orderId?: string; reason?: string; onchainRecordTxHash?: string | null; fulfillmentTxHash?: string | null; zkProofHash?: string; zkTxHash?: string | null } | null>(null);
  const [lastCreatedAt, setLastCreatedAt] = useState(0);
  const [toolSteps, setToolSteps] = useState<ToolProgress[]>([]);
  const [lastDelegate, setLastDelegate] = useState<DelegateResult | null>(null);
  const mode = useVeilMode();

  const run = async (): Promise<void> => {
    setBusy(true);
    setToolSteps([]);
    try {
      const res = await fetch('/api/veil/purchase/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task }),
      });
      if (!res.ok || !res.body) throw new Error(`stream failed: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7);
          else if (line.startsWith('data: ')) {
            const json = line.slice(6);
            if (eventType === 'progress') {
              const p = JSON.parse(json) as ToolProgress;
              setToolSteps((prev) => {
                const next = [...prev];
                const idx = next.findIndex((s) => s.step === p.step);
                if (idx >= 0) next[idx] = p; else next.push(p);
                return next;
              });
            } else if (eventType === 'done') {
              const body = JSON.parse(json) as { ok: boolean; orderId?: string; reason?: string; onchainRecordTxHash?: string | null; fulfillmentTxHash?: string | null; zkProofHash?: string; zkTxHash?: string | null };
              setLast(body);
              setLastCreatedAt(Date.now());
              onResult?.({
                ok: body.ok,
                text: body.ok
                  ? `Order ${body.orderId} settled through the rail.` + (body.onchainRecordTxHash ? ` AgentPayment on-chain: ${body.onchainRecordTxHash.slice(0, 10)}…${body.onchainRecordTxHash.slice(-6)}` : '')
                  : `Refused: ${body.reason}`,
              });
            } else if (eventType === 'error') {
              const err = JSON.parse(json) as { error: string };
              setLast({ ok: false, reason: err.error });
              onResult?.({ ok: false, text: err.error });
            }
          }
        }
      }
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
    setToolSteps([]);
    setLastDelegate(null);
  };

  const suggested = tab === 'direct' ? DIRECT_SUGGESTED : DELEGATE_SUGGESTED;

  return (
    <Card title="Purchase Console" right={<span className="font-mono text-[11px] text-mut">{tab === 'direct' ? '8 tools · mandate-gated' : 'A2A delegation'}</span>}>
      <div className="flex flex-col gap-4">
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
            <StatusChip status={last && !last.ok ? 'REJECTED' : busy ? 'PENDING' : 'PENDING'} label={busy ? 'executing' : 'agent'} />
            <span className="font-mono text-[13px] text-mut">
              {busy
                ? `running · ${toolSteps.filter((s) => s.status === 'done').length}/${toolSteps.length || '?'} tools verified`
                : last
                  ? last.ok
                    ? `ok · order ${last.orderId}`
                    : last.reason
                  : 'idle · deterministic planner + 8-tool surface'}
            </span>
          </div>
        )}

        {/* Live tool progress during execution */}
        {tab === 'direct' && busy && toolSteps.length > 0 && (
          <ToolProgressPanel steps={toolSteps} />
        )}

        {/* Direct mode pipeline after successful purchase */}
        {tab === 'direct' && last && last.ok && last.orderId && (
          <PurchasePipeline order={last} createdAt={lastCreatedAt} />
        )}

        {/* Final tool results after purchase */}
        {tab === 'direct' && last && last.ok && toolSteps.length > 0 && (
          <ToolProgressPanel steps={toolSteps} />
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