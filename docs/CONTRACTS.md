# VEIL - Smart Contracts

This document is a factual walkthrough of every contract in `contracts/src/`,
what state it holds, what external calls are allowed, and how the contracts
interlock. It mirrors the code - no speculative features.

Companion docs: `ATTESTCOIN.md` (the ASC + proof flow), `ARCHITECTURE.md`
(system view), `THREAT_MODEL.md` (attacker analysis).

---

## 1. Layout and dependencies

- Solidity `^0.8.23`.
- OpenZeppelin `Ownable` / `ReentrancyGuard` for the source-chain and
  Attestcoin-facing contracts.
- `OwnableLite` / `ReentrancyGuardLite` (repo-local, minimal) for the
  settlement-chain internal contracts.
- `@gluwa/usc-contracts@0.1.2` provides `EvmV1Decoder` and the
  `INativeQueryVerifier` / `NativeQueryVerifierLib` used by the ASC.
- Verified state: **19 contracts compile** with `0.8.23`
  (`node script/compile-check.js`), no warnings-as-errors.

| File | Chain | Inherits | Role |
|---|---|---|---|
| `VeilSource.sol` | Sepolia | OZ Ownable, OZ ReentrancyGuard | emits the events Attestcoin proves |
| `AttestationReceiver.sol` | CC3 | OZ Ownable | ASC; verifies proofs via precompile `0x0FD2` |
| `SettlementEngine.sol` | CC3 | OwnableLite, ReentrancyGuardLite | the only contract that releases/refunds escrow |
| `MandateManager.sol` | CC3 | OwnableLite | mandate state machine + budget ledger |
| `EscrowManager.sol` | CC3 | OwnableLite, ReentrancyGuardLite, IEscrowManager | escrow of CTC value |
| `ReputationEngine.sol` | CC3 | OwnableLite | settlement success/failure/refund/violation counters |
| `VeilRegistry.sol` | CC3 | OwnableLite | agent registry |
| `OwnableLite.sol`, `ReentrancyGuardLite.sol` | - | - | minimal base utilities |
| `interfaces/*.sol` | - | - | the wiring contracts use |

---

## 2. VeilSource.sol (source chain, Sepolia)

Kept intentionally minimal (verified Attestcoin best practice: source contracts
only hold minimal logic and emit events).

State:

```solidity
mapping(uint256 => address) public orderPaidBy;    // who paid orderId
mapping(uint256 => address) public orderProvider;  // who was paid for orderId
```

External functions:

| Function | Guard | Effect |
|---|---|---|
| `recordAgentPayment(orderId, provider, amount, serviceId, transactionRef)` | amount != 0; provider != 0; order not already paid | records payer + provider; emits `AgentPayment` |
| `recordFulfillment(orderId, resultHash, serviceId, transactionRef)` | order exists; `msg.sender == orderProvider` (hardening G1) | emits `FulfillmentReceipt` |
| `isOrderPaid(orderId)` | - | view |

Events (the exact payloads the ASC decodes):

```solidity
event AgentPayment(uint256 indexed orderId, address indexed agent,
  address indexed provider, uint256 amount, bytes32 serviceId,
  bytes32 transactionRef);

event FulfillmentReceipt(uint256 indexed orderId, address indexed provider,
  bytes32 resultHash, bytes32 serviceId, bytes32 transactionRef);
```

The `orderProvider` check on `recordFulfillment` closes the attack where a
non-payer address emits a `FulfillmentReceipt` that the ASC would otherwise mark
as verified.

---

## 3. AttestationReceiver.sol (ASC, Creditcoin CC3)

The **only** contract that can mark a payment or fulfillment as verified. Full
flow in `ATTESTCOIN.md`; here is the contract surface.

State:

```solidity
INativeQueryVerifier public immutable VERIFIER;      // precompile 0x0FD2
mapping(bytes32 => bool) public processedQueries;    // replay guard
address public veilSource;                           // allowlisted source contract
// per-order verified facts:
mapping(uint256 => bool)   public paymentsVerified;
mapping(uint256 => uint256) public verifiedPaymentAmounts;
mapping(uint256 => bytes32) public verifiedServiceId;
mapping(uint256 => address) public verifiedAgent;
mapping(uint256 => address) public verifiedProvider;
mapping(uint256 => bool)   public fulfillmentsVerified;
mapping(uint256 => bytes32) public verifiedResultHash;
```

Key entry point:

```solidity
function execute(uint8 action, uint64 chainKey, uint64 blockHeight,
  bytes calldata encodedTransaction, bytes32 merkleRoot,
  INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
  bytes32 lowerEndpointDigest, bytes32[] calldata continuityRoots)
  external returns (bool success);
```

Execution order (all verified behavior):

1. `queryId` = keccak over `(chainKey, blockHeight, txIndex)` where `txIndex`
   comes from the real precompile view `calculateTxIndex(merkleProof)`.
2. Revert if `processedQueries[queryId]` is already set (replay guard).
3. Mark the query processed **before** verification. If `_verifyProof` reverts,
   the entire call (mark included) rolls back, so a failed submit can never be
   blocked by a half-consumed queryId.
4. `_verifyProof` -> `VERIFIER.verifyAndEmit(...)`. False proof = revert.
5. `_processAndEmitEvent(action, queryId, encodedTransaction)`:
   - action 0 (Payment): decode via `EvmV1Decoder`, require the log's
     `address_ == veilSource`, signature == `AgentPayment`, `topics.length == 4`; set
     `paymentsVerified` + amount/serviceId/agent/provider; emit `PaymentVerified`.
   - action 1 (Fulfillment): same validation, `topics.length == 3`; set
     `fulfillmentsVerified` + `verifiedResultHash`; emit `FulfillmentVerified`.
   - else revert `InvalidAction`.

Validation in `_validateTransactionContents` (reverts):

| Check | Revert |
|---|---|
| `veilSource` registered | `SourceContractNotRegistered` |
| supported tx type | `UnsupportedTransactionType` |
| receipt status == 1 | `TransactionFailed` |
| event signature present and from `veilSource` | `SourceContractMismatch` |

View functions: `isPaymentVerified`, `isFulfillmentVerified`,
`verifiedPaymentAmount`, `verifiedServiceIdOf`, `verifiedAgentOf`,
`verifiedProviderOf`. The engine reads these before settling.

---

## 4. SettlementEngine.sol (Creditcoin CC3)

The orchestrator. Only the **settlement operator** can call `settle`/`refund`
(modifier `onlySettlementOperator`). Constructor binds `mandates`, `escrows`,
`attestationReceiver`, `reputation`; operator = deployer (changeable by owner).

`settle(orderId)` - the settlement gate list, in order:

| # | Check | Revert |
|---|---|---|
| 1 | escrow is `Locked` | `EscrowNotLocked` |
| 2 | ASC has a verified serviceId for the order | `InvalidAttestation` |
| 3 | mandate valid for `(mandateId, serviceId, amount)` | `BudgetNotCompliant` |
| 4 | `isPaymentVerified(orderId)` | `PaymentNotVerified` |
| 5 | `isFulfillmentVerified(orderId)` | `FulfillmentNotVerified` |
| 6 | verified amount >= escrow amount | `PaymentAmountMismatch` |
| 7 | escrow.payer == verifiedAgent, escrow.provider == verifiedProvider (G2) | `EscrowPartyMismatch` |

On success: `mandates.recordSpend(mandateId, amount)` (only engine may call),
`escrows.release(orderId)` (only engine may call), optional
`reputation.recordSettlementSuccess(provider)`, emit `SettlementExecuted`.

`refund(orderId)`:

- requires escrow `Locked`; calls `escrows.refund(orderId)` (payer or engine
  can refund at the escrow level, but the engine path is operator-only);
  records `recordRefund` + `recordSettlementFailure` on reputation.

Setters (owner only): `setSettlementOperator`, `setAttestationReceiver`,
`setReputationEngine`.

---

## 5. MandateManager.sol (Creditcoin CC3)

State machine: `None -> Active -> Revoked` (plus expiry).

```solidity
struct Mandate { address owner; uint256 agentId; uint256 budget;
                 uint256 spent; bytes32 allowedService; uint64 expiration;
                 MandateState state; }
```

| Function | Caller | Effect |
|---|---|---|
| `createMandate(agentId, budget, allowedService, expiration)` | anyone (owner = caller) | budget != 0, expiration in future; new Active mandate |
| `revokeMandate(mandateId)` | mandate owner | -> Revoked |
| `isMandateValid(mandateId, serviceId, amount)` | view | owner set, Active, not expired, service matches, remaining >= amount |
| `recordSpend(mandateId, amount)` | **only settlement engine** | spent += amount (reverts if not Active/expired/budget exceeded) |
| `remainingBudget(mandateId)` | view | budget - spent, floor 0 |

Errors used by settle: `BudgetExceeded`, `MandateExpired`, `MandateNotActive`,
`ServiceNotAllowed`.

---

## 6. EscrowManager.sol (Creditcoin CC3)

State machine: `None -> Locked -> Released | Refunded`. Escrow holds **CTC**
(`msg.value` on `createEscrow`).

| Function | Caller | Effect |
|---|---|---|
| `createEscrow(orderId, mandateId, provider)` | anyone, payable | value > 0, status None -> Locked; records payer/provider/mandate/amount |
| `release(orderId)` | **only settlement engine** | Locked -> Released; sends amount to provider |
| `refund(orderId)` | payer or settlement engine | Locked -> Refunded; sends amount to payer |

Errors: `EscrowExists`, `EscrowNotFound`, `InvalidAmount`, `InvalidProvider`,
`InvalidStatus`, `IncorrectValue` (transfer failed).

---

## 7. ReputationEngine.sol (Creditcoin CC3)

Per-account counters:

```solidity
struct Reputation { uint256 successfulSettlements; uint256 failedSettlements;
                    uint256 refunds; uint256 policyViolations; }
```

All write functions are **only settlement engine**: `recordSettlementSuccess`,
`recordSettlementFailure`, `recordRefund`, `recordPolicyViolation`. Read:
`reputationOf(account)`.

---

## 8. VeilRegistry.sol (Creditcoin CC3)

Agent registry. `registerAgent(reputationRef)` (owner = caller, Active),
`revokeAgent(agentId)` (owner only), `updateReputationRef(agentId, ref)`
(registry owner only), `requireActiveAgent(agentId)` (reverts unless Active),
plus views `agentOwner`, `agentStatus`, `reputationRef`.

---

## 9. Interlock summary (who may call what)

| Caller | May call |
|---|---|
| ASC owner | `registerVeilSource` |
| Settlement operator | `SettlementEngine.settle`, `SettlementEngine.refund` |
| Settlement engine | `MandateManager.recordSpend`, `EscrowManager.release`, `ReputationEngine.*` writes |
| Escrow payer | `EscrowManager.refund` (own escrow) |
| Mandate owner | `MandateManager.revokeMandate` |
| Agent owner | `VeilRegistry.revokeAgent` |
| Anyone | `createEscrow` (payable), `createMandate`, `registerAgent`, all views |

The result: money (CTC) on Creditcoin moves only through
`SettlementEngine.settle`/`refund` -> `EscrowManager.release`/`refund`, and the
engine refuses to move it until the **ASC** says the source-chain payment +
fulfillment are verified, the **mandate** is valid, and the **escrow
counterparties** match the ASC-verified identities.

---

## 10. Test coverage

- `contracts/test/VeilFoundation.t.sol` - Foundry suite (written, ready to run;
  `forge` is not installed on this box).
- The in-repo verification is `node script/compile-check.js`: **19 contracts
  compile** with `0.8.23`, including `EvmV1Decoder` and OpenZeppelin imports
  resolved via remap callback.

`DEPLOYMENT.md` covers deployment order and `script/deploy.ts`.
