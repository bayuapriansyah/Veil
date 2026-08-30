'use client';

import { Spinner, Warning } from '@phosphor-icons/react';
import type { ToolProgress } from '../../services/procurement/types';

function StatusIcon({ status }: { status: ToolProgress['status'] }): React.ReactElement {
  switch (status) {
    case 'pending':
      return <span className="inline-block h-4 w-4 rounded-full border-2 border-line" />;
    case 'running':
      return <Spinner className="h-4 w-4 animate-spin text-attest" weight="bold" />;
    case 'done':
      return (
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-ok/20">
          <svg className="h-2.5 w-2.5 text-ok" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2 6 5 9 10 3" />
          </svg>
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-bad/20">
          <svg className="h-2.5 w-2.5 text-bad" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="3" x2="9" y2="9" />
            <line x1="9" y1="3" x2="3" y2="9" />
          </svg>
        </span>
      );
  }
}

const STATUS_LABEL: Record<ToolProgress['status'], string> = {
  pending: 'Queued',
  running: 'Executing',
  done: 'Verified',
  failed: 'Failed',
};

const STATUS_TONE: Record<ToolProgress['status'], string> = {
  pending: 'text-mut/60',
  running: 'text-attest',
  done: 'text-ok',
  failed: 'text-bad',
};

const TOOL_LABELS: Record<string, string> = {
  searchProviders: 'Discover providers',
  getProviderDetails: 'Read provider profile',
  checkProviderSecurity: 'Security bytecode scan',
  checkReputation: 'Reputation check',
  checkMandate: 'Mandate verification',
  checkBudget: 'Budget check',
  requestService: 'Reserve payment offer',
  makePayment: 'Execute payment',
};

export function ToolProgressPanel({ steps }: { steps: ToolProgress[] }): React.ReactElement | null {
  if (steps.length === 0) return null;

  const done = steps.filter((s) => s.status === 'done').length;
  const total = steps.length;
  const pct = total > 0 ? (done / total) * 100 : 0;
  const current = steps.find((s) => s.status === 'running');
  const failed = steps.find((s) => s.status === 'failed');

  return (
    <div className="rounded-lg border border-line bg-panel2/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-medium text-ink">Agent Execution</span>
          <span className="font-mono text-[12px] text-mut">{done}/{total}</span>
        </div>
        {current && (
          <div className="flex items-center gap-1.5">
            <Spinner className="h-3 w-3 animate-spin text-attest" weight="bold" />
            <span className="font-mono text-[12px] text-attest">{current.rationale}</span>
          </div>
        )}
        {!current && !failed && done === total && (
          <span className="font-mono text-[12px] text-ok">complete</span>
        )}
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-panel2">
        <div className="h-full rounded-full bg-ok transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-3 space-y-1.5">
        {steps.map((s) => (
          <div key={s.step} className={`flex items-center gap-2.5 text-[13px] ${STATUS_TONE[s.status]}`}>
            <StatusIcon status={s.status} />
            <span className="font-medium">{s.step + 1}.</span>
            <span className="flex-1">{TOOL_LABELS[s.tool] ?? s.tool}</span>
            {s.status === 'done' && s.summary && (
              <span className="font-mono text-[11px] text-mut">{s.summary}</span>
            )}
            {s.status === 'done' && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-ok/70">verified</span>
            )}
            {s.status === 'failed' && s.error && (
              <span className="font-mono text-[11px] text-bad">{s.error}</span>
            )}
            {s.status === 'running' && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-attest/70">running</span>
            )}
            {s.status === 'pending' && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-mut/40">queued</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
