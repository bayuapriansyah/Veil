'use client';

import { Card, PageHeader } from '@/components/ui';
import { Fingerprint, Lock, Eye, ShieldWarning } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

interface LayerRow {
  layer: string;
  icon: Icon;
  tone: string;
  who: string;
  what: string;
  how: string;
}

const LAYERS: LayerRow[] = [
  {
    layer: 'Public facts',
    icon: Eye,
    tone: 'text-ok border-ok/40 bg-ok/5',
    who: 'Everyone — including anyone browsing the CC3 explorer',
    what: 'Only that a payment happened, a fulfillment was verified, and escrow settled. Commitments and event logs, no contents.',
    how: 'Attestcoin proofs on Creditcoin CC3 · AttestationReceiver events · SettlementEngine state',
  },
  {
    layer: 'Sealed private data',
    icon: Lock,
    tone: 'text-pend border-pend/40 bg-pend/5',
    who: 'No one — the data is encrypted at rest with AES-256-GCM',
    what: 'Amounts, counterparties, agent identity, task details, service metadata. Tampering is detected cryptographically.',
    how: 'AuditVault AES-256-GCM sealing · commitment hash binds sealed data to the public record',
  },
  {
    layer: 'Authorized audit',
    icon: Fingerprint,
    tone: 'text-ink border-line bg-panel2/60',
    who: 'Only auditors holding an operator-granted, EIP-712-signed authorization',
    what: 'Selective disclosure: specific fields of specific transactions. Full evidence bundle only when explicitly granted.',
    how: 'EIP-712 AuditAccess grants · per-request nonce (replay denied) · revocation stops access instantly',
  },
];

const GUARANTEES = [
  { title: 'Never faked', body: 'Facts flip to verified only after Creditcoin native attestation verifies the source-chain event. The UI cannot overclaim.' },
  { title: 'Never all-or-nothing', body: 'An auditor sees exactly the fields they were granted — not the whole transaction history.' },
  { title: 'Revocable', body: 'A revoked auditor is denied immediately; replaying an old signed request fails on the nonce check.' },
  { title: 'Tamper-evident', body: 'Any modification of sealed metadata breaks the AES-GCM authentication tag and is reported as corruption.' },
];

export default function PrivacyPage(): React.ReactElement {
  return (
    <div>
      <PageHeader
        title="Privacy & Disclosure Model"
        sub="Who can see what in VEIL. Company-grade transaction privacy with regulator-grade verifiability."
      />

      <div className="space-y-4">
        {LAYERS.map((l) => {
          const Icon = l.icon;
          return (
            <Card key={l.layer}>
              <div className="flex items-start gap-4">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${l.tone}`}>
                  <Icon size={22} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-mono text-sm font-semibold uppercase tracking-wider text-ink">{l.layer}</h3>
                  <p className="mt-1 text-sm text-mut">
                    <span className="text-ink">Who:</span> {l.who}
                  </p>
                  <p className="mt-1 text-sm text-mut">
                    <span className="text-ink">What:</span> {l.what}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-mut/70">{l.how}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {GUARANTEES.map((g) => (
          <div key={g.title} className="rounded-xl border border-line bg-panel p-4">
            <div className="flex items-center gap-2">
              <ShieldWarning size={16} className="text-ok" />
              <h4 className="font-mono text-[12px] font-semibold uppercase tracking-wider text-ink">{g.title}</h4>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-mut">{g.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-line bg-panel p-5">
        <h4 className="font-mono text-[12px] font-semibold uppercase tracking-wider text-ink">Try it live</h4>
        <p className="mt-2 text-sm leading-relaxed text-mut">
          The <span className="text-ink">Audit</span> page exercises this model end-to-end: authorize an auditor,
          disclose selectively, revoke, and watch an unauthorized replay get denied — all against real EIP-712
          signatures and AES-256-GCM sealed records.
        </p>
      </div>
    </div>
  );
}
