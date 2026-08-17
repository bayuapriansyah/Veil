// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {OwnableLite} from "./OwnableLite.sol";
import {ReentrancyGuardLite} from "./ReentrancyGuardLite.sol";
import {IAttestationReceiver} from "./interfaces/IAttestationReceiver.sol";
import {IMandateManager} from "./interfaces/IMandateManager.sol";
import {IEscrowManager} from "./interfaces/IEscrowManager.sol";
import {ReputationEngine} from "./ReputationEngine.sol";

contract SettlementEngine is OwnableLite, ReentrancyGuardLite {
    IMandateManager public immutable mandates;
    IEscrowManager public immutable escrows;
    IAttestationReceiver public attestationReceiver;
    ReputationEngine public reputation;
    address public settlementOperator;

    error InvalidMandate();
    error PaymentNotVerified();
    error FulfillmentNotVerified();
    error BudgetNotCompliant();
    error PaymentAmountMismatch();
    error EscrowNotLocked();
    error InvalidAttestation();
    error EscrowPartyMismatch();

    event SettlementOperatorSet(address indexed operator);
    event AttestationReceiverSet(address indexed receiver);
    event ReputationEngineSet(address indexed reputation);
    event SettlementExecuted(uint256 indexed orderId, uint256 indexed mandateId, address indexed provider, uint256 amount);
    event SettlementRefunded(uint256 indexed orderId, uint256 indexed mandateId, address indexed provider, uint256 amount);

    modifier onlySettlementOperator() {
        if (msg.sender != settlementOperator) revert Unauthorized();
        _;
    }

    constructor(IMandateManager mandateManager, IEscrowManager escrowManager, IAttestationReceiver receiver, ReputationEngine reputationEngine) {
        if (address(mandateManager) == address(0) || address(escrowManager) == address(0) || address(receiver) == address(0)) revert ZeroAddress();
        mandates = mandateManager;
        escrows = escrowManager;
        attestationReceiver = receiver;
        reputation = reputationEngine;
        settlementOperator = msg.sender;
        emit SettlementOperatorSet(msg.sender);
    }

    function setSettlementOperator(address operator) external onlyOwner {
        if (operator == address(0)) revert ZeroAddress();
        settlementOperator = operator;
        emit SettlementOperatorSet(operator);
    }

    function setAttestationReceiver(IAttestationReceiver receiver) external onlyOwner {
        if (address(receiver) == address(0)) revert ZeroAddress();
        attestationReceiver = receiver;
        emit AttestationReceiverSet(address(receiver));
    }

    function setReputationEngine(ReputationEngine reputationEngine) external onlyOwner {
        if (address(reputationEngine) == address(0)) revert ZeroAddress();
        reputation = reputationEngine;
        emit ReputationEngineSet(address(reputationEngine));
    }

    function settle(uint256 orderId) external onlySettlementOperator nonReentrant {
        if (escrows.escrowStatus(orderId) != IEscrowManager.EscrowStatus.Locked) revert EscrowNotLocked();
        uint256 mandateId = escrows.escrowMandate(orderId);
        uint256 amount = escrows.escrowAmount(orderId);
        address provider = escrows.escrowProvider(orderId);
        bytes32 serviceId = attestationReceiver.verifiedServiceIdOf(orderId);
        if (serviceId == bytes32(0)) revert InvalidAttestation();
        if (!mandates.isMandateValid(mandateId, serviceId, amount)) revert BudgetNotCompliant();
        if (!attestationReceiver.isPaymentVerified(orderId)) revert PaymentNotVerified();
        if (!attestationReceiver.isFulfillmentVerified(orderId)) revert FulfillmentNotVerified();
        if (attestationReceiver.verifiedPaymentAmount(orderId) < amount) revert PaymentAmountMismatch();
        // The escrow's counterparties MUST equal the ASC-verified ones: the order
        // attributing this spend to a payer/provider comes from source-chain facts,
        // not from whoever happened to lock the escrow.
        if (escrows.escrowPayer(orderId) != attestationReceiver.verifiedAgentOf(orderId)) revert EscrowPartyMismatch();
        if (escrows.escrowProvider(orderId) != attestationReceiver.verifiedProviderOf(orderId)) revert EscrowPartyMismatch();
        mandates.recordSpend(mandateId, amount);
        escrows.release(orderId);
        if (address(reputation) != address(0)) reputation.recordSettlementSuccess(provider);
        emit SettlementExecuted(orderId, mandateId, provider, amount);
    }

    function refund(uint256 orderId) external onlySettlementOperator nonReentrant {
        if (escrows.escrowStatus(orderId) != IEscrowManager.EscrowStatus.Locked) revert EscrowNotLocked();
        uint256 mandateId = escrows.escrowMandate(orderId);
        uint256 amount = escrows.escrowAmount(orderId);
        address provider = escrows.escrowProvider(orderId);
        escrows.refund(orderId);
        if (address(reputation) != address(0)) {
            reputation.recordRefund(provider);
            reputation.recordSettlementFailure(provider);
        }
        emit SettlementRefunded(orderId, mandateId, provider, amount);
    }
}
