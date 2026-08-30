# VEIL — Team

**Project:** VEIL — Verifiable Economic Infrastructure Layer for Autonomous AI Agents

**Track:** AI

**Event:** BUIDL CTC 2026 Fall

## Members

| Name | Role | GitHub |
|---|---|---|
| Bayu Apriansyah Putra | Builder (architecture, Solidity, Attestcoin integration, console) | [bayuapriansyah](https://github.com/bayuapriansyah) |

## What we built

VEIL gives an autonomous AI agent a way to pay for services it can independently
verify happened, on a rail where a human stays in control.

- **Cross-chain proof loop (live).** Every purchase emits a real
  `AgentPayment`/`FulfillmentReceipt` on Sepolia (`VeilSource`), the worker
  generates a real proof via the Attestcoin Proof Builder, submits it to the
  `AttestationReceiver` ASC on Creditcoin CC3, and attaches the verified proof
  to the audit vault — 8/8 events verified on CC3 during development.
- **AI agent.** A procurement agent (deterministic planner, optional LLM) that
  discovers providers, checks mandates/budget/reputation, and pays over a real
  HTTP rail (x402 handshake + `veil-exact` EIP-712 signature, ECRECOVER
  verified).
- **Privacy + audit.** AES-256-GCM sealed vault at rest, EIP-712 `AuditAccess`
  selective disclosure, auditor registry, kill switch.

## How to run

See [README.md](README.md) and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

- Zero-setup demo: `cd frontend && npm install && npm run dev` →
  http://localhost:3000 (demo mode generates agent wallets automatically).
- Live Attestcoin: see [docs/TESTNET.md](docs/TESTNET.md).

## Honest status

The repo separates **production**, **hackathon prototype**, and **roadmap**
claims throughout (see README "Attestcoin integration status" and
[docs/ATTESTCOIN.md](docs/ATTESTCOIN.md)). Settlement is mirrored in the demo
ledger unless explicitly marked live; the live Attestcoin loop
(Sepolia → Creditcoin) is executed and verified for real.