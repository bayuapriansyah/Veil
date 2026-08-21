'use client';

import { Robot, Stack } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { Card, PageHeader, StatusChip } from '../../../components/ui';
import { ProviderView, VeilState, shortAddress } from '../../../lib/veil-client';
import { usePoll } from '../../../lib/use-poll';

interface RegisteredAgent {
  agentId: number;
  owner: string;
  status: number;
  endpoint: string;
  cardHash: string;
  registeredAt: number;
  lastHealthCheck: number;
}

const EMPTY_STATE: VeilState = {
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
  mode: 'demo',
};

export default function AgentsPage(): React.ReactElement {
  const { data } = usePoll<{ ok: boolean; state: VeilState }>('/api/veil/state', { ok: true, state: EMPTY_STATE });
  const { data: providers } = usePoll<{ ok: boolean; providers: ProviderView[] }>('/api/veil/providers', {
    ok: true,
    providers: [],
  });
  const { data: registryData } = usePoll<{ ok: boolean; agents: RegisteredAgent[]; registryAddress: string }>(
    '/api/veil/registry',
    { ok: true, agents: [], registryAddress: '' },
  );
  const s = data.state ?? EMPTY_STATE;
  const registry = providers.providers ?? [];
  const onChainAgents = registryData.agents ?? [];

  const [regEndpoint, setRegEndpoint] = useState('');
  const [regCardHash, setRegCardHash] = useState('');
  const [registering, setRegistering] = useState(false);
  const [regResult, setRegResult] = useState<string | null>(null);

  async function handleRegister() {
    if (!regEndpoint) return;
    setRegistering(true);
    setRegResult(null);
    try {
      const res = await fetch('/api/veil/registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: regEndpoint, agentCardHash: regCardHash }),
      });
      const data = await res.json();
      if (data.ok) {
        setRegResult(`Registered! agentId=${data.agentId}, tx=${data.txHash}`);
        setRegEndpoint('');
        setRegCardHash('');
      } else {
        setRegResult(`Error: ${data.error}`);
      }
    } catch (e) {
      setRegResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Agents"
        sub="One operator agent drives the purchases; every provider runs its own settlement ledger behind it. Open an agent to inspect its identity, tool surface and live rail."
      />

      <Card title="Operator agent" right={<StatusChip status={s.agent.status === 'active' ? 'VERIFIED' : 'REJECTED'} label={s.agent.status.toUpperCase()} />}>
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-ok/40 bg-ok/10">
              <Robot size={26} weight="regular" className="text-ok" />
            </div>
            <div>
              <div className="font-mono text-base text-ink">{shortAddress(s.agent.address, 6)}</div>
              <div className="mt-0.5 text-sm text-mut">deterministic planner · 7 tools</div>
            </div>
          </div>
          <Link href={`/app/agents/${s.agent.address}`} className="btn-muted">
            Open cockpit
          </Link>
        </div>
      </Card>

      {/* On-chain Agent Registry */}
      <div className="mt-8">
        <h2 className="mb-4 text-base font-semibold text-ink flex items-center gap-2">
          <Stack size={18} weight="regular" /> On-chain Agent Registry (CC3)
        </h2>
        <div className="grid gap-5 md:grid-cols-2">
          {onChainAgents.map((a) => (
            <Card
              key={a.agentId}
              title={
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm">#{a.agentId}</span>
                  <StatusChip status={a.status === 1 ? 'VERIFIED' : 'REJECTED'} label={a.status === 1 ? 'ACTIVE' : 'REVOKED'} />
                </div>
              }
              right={<span className="font-mono text-xs text-mut">{shortAddress(a.owner, 6)}</span>}
            >
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-mut">Endpoint</span>
                  <span className="font-mono text-xs text-ink">{a.endpoint}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-mut">Registered</span>
                  <span className="text-xs text-ink">{new Date(a.registeredAt * 1000).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-mut">Last Health</span>
                  <span className="text-xs text-ink">{new Date(a.lastHealthCheck * 1000).toLocaleString()}</span>
                </div>
              </div>
            </Card>
          ))}
          {onChainAgents.length === 0 && <p className="text-sm text-mut">No registered agents on-chain yet.</p>}
        </div>
      </div>

      {/* Register Agent Form */}
      <div className="mt-8">
        <Card title="Register New Agent">
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-mut">Endpoint URL</label>
              <input
                type="text"
                value={regEndpoint}
                onChange={(e) => setRegEndpoint(e.target.value)}
                placeholder="http://127.0.0.1:8081"
                className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 font-mono text-sm text-ink"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-mut">Agent Card Hash (optional)</label>
              <input
                type="text"
                value={regCardHash}
                onChange={(e) => setRegCardHash(e.target.value)}
                placeholder="QmHash or IPFS URI"
                className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 font-mono text-sm text-ink"
              />
            </div>
            <button
              onClick={handleRegister}
              disabled={registering || !regEndpoint}
              className="rounded-lg bg-ok px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              {registering ? 'Registering…' : 'Register Agent'}
            </button>
            {regResult && (
              <p className={`text-sm ${regResult.startsWith('Error') ? 'text-fail' : 'text-ok'}`}>{regResult}</p>
            )}
          </div>
        </Card>
      </div>

      {/* Provider agents */}
      <div className="mt-8">
        <h2 className="mb-4 text-base font-semibold text-ink">Provider agents</h2>
        <div className="grid gap-5 md:grid-cols-2">
          {registry.map((p) => (
            <Card
              key={p.provider}
              title={
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm">{shortAddress(p.provider, 6)}</span>
                  <StatusChip status={p.eligible ? 'VERIFIED' : 'REJECTED'} label={p.eligible ? 'ELIGIBLE' : 'EXCLUDED'} />
                </div>
              }
              right={<span className="font-mono text-sm text-pend">rep {p.reputation}</span>}
            >
              <div className="flex items-center justify-between text-sm text-mut">
                <span>{p.services.length} service(s)</span>
                <span>{p.activeMandates} active mandates</span>
              </div>
              <div className="mt-4 space-y-2.5">
                {p.services.slice(0, 2).map((sv) => (
                  <div key={sv.serviceId} className="rounded-lg border border-line bg-panel2/70 px-3.5 py-2.5 text-sm">
                    <span className="font-medium text-ink">{sv.name}</span>
                    <span className="ml-2 text-mut">{sv.description}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          {registry.length === 0 && <p className="text-sm text-mut">Loading provider catalog…</p>}
        </div>
      </div>
    </div>
  );
}