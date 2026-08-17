'use client';

import { useState } from 'react';
import { CaretDown, Cpu, Database, LockSimple, Robot, ShieldCheck, Stack } from '@phosphor-icons/react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Reveal } from './reveal';

const LAYERS = [
  {
    icon: Robot,
    tag: 'agent',
    name: 'Procurement Agent',
    role: 'Plans purchases with a deterministic 9-step planner over exactly 7 tools. Holds no settle, refund or budget authority.',
    details: [
      'discovery filters to providers with reputation ≥ 3',
      'makePayment is the only payment path',
      'no privileged tools: the ledger decides',
    ],
  },
  {
    icon: Cpu,
    tag: 'rail',
    name: 'Procurement Shop + x402 rail',
    role: 'Runs the payment path over the real x402 HTTP rail with the exact-amount policy. Each provider runs its own settlement ledger inside the shop.',
    details: [
      'requestService reserves an offer, gated by mandate and budget',
      'operator and provider identities are bound at setup',
    ],
  },
  {
    icon: ShieldCheck,
    tag: 'proof',
    name: 'Attestation layer',
    role: 'Cross-chain commitment of payment and fulfillment. The demo mirrors AttestationReceiver and ASC state; no live cross-chain submission is claimed.',
    details: [
      'payment and fulfillment each require an attestation',
      'issuer sets an Attestcoin (ASC) as the attestation sink',
      'UI always labels mirrored state as mirror',
    ],
  },
  {
    icon: LockSimple,
    tag: 'vault',
    name: 'Audit Vault',
    role: 'Stores a public register of facts and a sealed vault of evidence. AES-256-GCM with an ephemeral runtime key.',
    details: [
      'public: txId, commitment, status banners',
      'sealed: amounts, agents, evidence',
      'opened only to authorized auditors via signed AuditAccess',
    ],
  },
  {
    icon: Database,
    tag: 'ledger',
    name: 'Settlement Engine',
    role: 'The authority on payment. Only the operator settles escrow, and only after both verifications and a party-binding check.',
    details: [
      'escrow payer and provider must equal the attested parties',
      'spend increments only at operator settlement',
      'kill switch revokes every mandate at once',
    ],
  },
  {
    icon: Stack,
    tag: 'contracts',
    name: 'Veil Source',
    role: 'The on-chain source of truth (Solidity) when the rail reaches mainnet: VeilSource, AttestationReceiver, SettlementEngine.',
    details: [
      'recordFulfillment requires the real order provider',
      'contracts compiled and tested (forge unavailable locally)',
    ],
  },
] as const;

export function Architecture(): React.ReactElement {
  const [open, setOpen] = useState<number | null>(0);
  const reduce = useReducedMotion();

  return (
    <section id="architecture" className="mx-auto max-w-6xl px-6 py-20 md:py-28">
      <Reveal>
        <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-ink md:text-4xl">
          Six layers, each with one job.
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-mut">
          VEIL keeps the agent, the rail, the proof, the vault, the ledger and the contract in separate layers so the
          authority never lives in the hands that spend.
        </p>
      </Reveal>

      <div className="mt-12 space-y-3">
        {LAYERS.map((layer, i) => {
          const isOpen = open === i;
          return (
            <Reveal key={layer.name} delay={0.04 * i}>
              <div className={`rounded-panel border bg-panel transition-colors ${isOpen ? 'border-attest/40' : 'border-line'}`}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-4 px-6 py-5 text-left"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-line bg-panel2">
                    <layer.icon size={18} weight="regular" className="text-attest" />
                  </span>
                  <span className="flex-1">
                    <span className="block font-mono text-[10px] uppercase tracking-[0.2em] text-mut">{layer.tag}</span>
                    <span className="block text-base font-semibold text-ink">{layer.name}</span>
                  </span>
                  <CaretDown
                    size={16}
                    weight="regular"
                    className={`shrink-0 text-mut transition-transform duration-fast ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="body"
                      initial={reduce ? undefined : { height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={reduce ? undefined : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-line px-6 py-5">
                        <p className="text-sm leading-relaxed text-mut">{layer.role}</p>
                        <ul className="mt-4 space-y-1.5">
                          {layer.details.map((d) => (
                            <li key={d} className="flex items-start gap-2 text-sm text-mut">
                              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-attest/60" />
                              {d}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}