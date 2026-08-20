'use client';

import { Card, PageHeader, StatusChip, Address } from '@/components/ui';
import { ProviderView, atomsUsd } from '@/lib/veil-client';
import { usePoll } from '@/lib/use-poll';

export default function ProvidersPage(): React.ReactElement {
  const { data } = usePoll<{ ok: boolean; providers: ProviderView[] }>('/api/veil/providers', { ok: true, providers: [] });
  const providers = data.providers ?? [];

  return (
    <div>
      <PageHeader
        title="Providers"
        sub="Discovery filters to providers with ledger reputation ≥ 3. Each provider runs its own settlement ledger + x402 rail inside the shop."
        right={
          <span className="rounded-full border border-line bg-panel px-3.5 py-1.5 font-mono text-[11px] text-mut">
            {providers.length} registered
          </span>
        }
      />

      <div className="grid gap-5 md:grid-cols-2">
        {providers.map((p) => (
          <Card
            key={p.provider}
            title={
              <div className="flex items-center gap-3">
                <span>{p.provider.slice(0, 10)}…</span>
                <StatusChip status={p.eligible ? 'VERIFIED' : 'REJECTED'} label={p.eligible ? 'ELIGIBLE' : 'EXCLUDED'} />
              </div>
            }
            right={<span className="font-mono text-sm text-pend">rep {p.reputation}</span>}
          >
            <div className="mb-4 flex items-center gap-3">
              <Address addr={p.provider} />
              <span className="font-mono text-[13px] text-mut">{p.activeMandates} active mandates</span>
            </div>
            <div className="space-y-2.5">
              {p.services.map((sv) => (
                <div key={sv.serviceId} className="rounded-lg border border-line bg-panel2/70 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] font-medium text-ink">{sv.name}</span>
                    <span className="font-mono text-[13px] text-ok">{atomsUsd(sv.pricePerCallAtoms)} USD / call</span>
                  </div>
                  <p className="mt-1.5 text-sm text-mut">{sv.description}</p>
                  <div className="mt-2.5 font-mono text-xs text-mut">serviceId {sv.serviceId.slice(0, 18)}…</div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {providers.length === 0 && (
        <Card>
          <p className="py-10 text-center text-sm text-mut">Loading provider catalog…</p>
        </Card>
      )}
    </div>
  );
}