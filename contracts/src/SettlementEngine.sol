// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {OwnableLite} from "./OwnableLite.sol";
import {ReentrancyGuardLite} from "./ReentrancyGuardLite.sol";
import {IAttestationReceiver} from "./interfaces/IAttestationReceiver.sol";
import {IMandateManager} from "./interfaces/IMandateManager.sol";
import {IEscrowManager} from "./interfaces/IEscrowManager.sol";
import {ReputationEngine} from "./ReputationEngine.sol";

/// @title SettlementEngine
/// @notice Settles orders on Creditcoin after cross-chain attestation.
/// @dev    The operator provides `salt` at settlement time. The engine verifies
///         that keccak256(provider, amount, serviceId, salt) matches the on-chain
///         commitment stored by the AttestationReceiver. This ensures the operator
///         cannot forge settlement data without the vault preimage.
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
    error EscrowNotLocked();
    error InvalidAttestation();
    error ZKProofNotVerified();
    error CommitmentMismatch();

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

    /// @notice Settles an order after cross-chain attestation.
    /// @dev    The operator provides `salt` which, together with the escrow's
    ///         provider/amount and the mandate's serviceId, must hash to the
    ///         on-chain commitment. This binds the settlement to the original
    ///         purchase without revealing the preimage on-chain.
    /// @param orderId The order to settle.
    /// @param salt The commitment salt (revealed from vault at settlement time).
    function settle(uint256 orderId, bytes32 salt) external onlySettlementOperator nonReentrant {
        if (escrows.escrowStatus(orderId) != IEscrowManager.EscrowStatus.Locked) revert EscrowNotLocked();
        uint256 mandateId = escrows.escrowMandate(orderId);
        uint256 amount = escrows.escrowAmount(orderId);
        address provider = escrows.escrowProvider(orderId);

        if (!attestationReceiver.isPaymentVerified(orderId)) revert PaymentNotVerified();
        if (!attestationReceiver.isFulfillmentVerified(orderId)) revert FulfillmentNotVerified();
        if (!attestationReceiver.isZKReceiptVerified(orderId)) revert ZKProofNotVerified();

        // Verify commitment: keccak256(provider, amount, serviceId, salt) == on-chain commitment
        bytes32 commitment = attestationReceiver.verifiedCommitmentOf(orderId);
        if (commitment == bytes32(0)) revert InvalidAttestation();
        bytes32 computed = keccak256(abi.encodePacked(provider, amount, _serviceIdOf(mandateId), salt));
        if (computed != commitment) revert CommitmentMismatch();

        if (!mandates.isMandateValid(mandateId, _serviceIdOf(mandateId), amount)) revert BudgetNotCompliant();
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

    function _serviceIdOf(uint256 mandateId) internal view returns (bytes32) {
        return mandates.allowedServiceOf(mandateId);
    }
}
