'use client';

import { useState } from 'react';
import { api, VeilState, atomsUsd } from '../lib/veil-client';
import { Card, StatusChip } from './ui';

const SUGGESTED = ['Buy one unit of live market data for my trading dashboard', 'Purchase a market data feed (one call)'];

export function PurchaseConsole({ onResult }: { onResult?: (msg: { ok: boolean; text: string }) => void }): React.ReactElement {
  const [task, setTask] = useState(SUGGESTED[0]);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ ok: boolean; orderId?: string; reason?: string; onchainRecordTxHash?: string } | null>(null);

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const body = await api<{ ok: boolean; orderId?: string; reason?: string; onchainRecordTxHash?: string }>('/api/veil/purchase', {
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

  return (
    <Card title="Purchase Console" right={<span className="font-mono text-[11px] text-mut">7 tools · mandate-gated</span>}>
      <div className="flex flex-col gap-4">
        <textarea
          className="input-dark min-h-[100px] resize-y font-mono text-sm"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Describe the purchase you want the agent to make…"
        />
        <div className="flex flex-wrap items-center gap-2.5">
          <button className="btn-primary" onClick={() => void run()} disabled={busy || !task.trim()}>
            {busy ? 'Executing…' : 'Run purchase'}
          </button>
          {SUGGESTED.map((s) => (
            <button key={s} className="btn-muted text-[13px]" onClick={() => setTask(s)} disabled={busy}>
              {s.split(' ').slice(0, 4).join(' ') + '…'}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-line bg-panel2/60 px-4 py-2.5">
          <StatusChip status={last && !last.ok ? 'REJECTED' : 'PENDING'} label="agent" />
          <span className="font-mono text-[13px] text-mut">
            {last
              ? last.ok
                ? `ok · order ${last.orderId}`
                : last.reason
              : 'idle · deterministic planner + 7-tool surface'}
          </span>
        </div>
      </div>
    </Card>
  );
}

export function KillSwitch({ state, onDied }: { state: VeilState; onDied?: () => void }): React.ReactElement {
  const [busy, setBusy] = useState(false);
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