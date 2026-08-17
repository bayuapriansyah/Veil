// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EvmV1Decoder} from "@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol";
import {INativeQueryVerifier, NativeQueryVerifierLib} from "./interfaces/INativeQueryVerifier.sol";
import {IAttestationReceiver} from "./interfaces/IAttestationReceiver.sol";

/// @title AttestationReceiver
/// @notice Attestcoin Smart Contract (ASC) for VEIL, deployed on Creditcoin.
/// @dev    This is the ONLY contract that can mark a cross-chain payment or
///         fulfillment as verified. It verifies Merkle + continuity proofs via
///         the BlockProver precompile (0x0FD2) and decodes the source-chain
///         transaction bytes with the official EvmV1Decoder. It NEVER fabricates
///         a verification result: state only changes after a real proof is
///         validated synchronously by Creditcoin's native verifier.
///
///         Flow:
///           SOURCE CHAIN (Sepolia) --AgentPayment/FulfillmentReceipt event-->
///           worker generates proof (gluwa usc-sdk) -->
///           execute() verifies via precompile -->
///           state updated: paymentVerified / fulfillmentVerified
contract AttestationReceiver is Ownable, IAttestationReceiver {
    // ------------------------------------------------------------------ //
    //  Verified Attestcoin primitives                                    //
    // ------------------------------------------------------------------ //
    INativeQueryVerifier public immutable VERIFIER;
    mapping(bytes32 => bool) public processedQueries;

    // Event signatures of the VeilSource contract on the source chain.
    // AgentPayment(uint256 indexed orderId, address indexed agent, address indexed provider, uint256 amount, bytes32 serviceId, bytes32 transactionRef)
    bytes32 public constant AGENT_PAYMENT_EVENT_SIGNATURE =
        keccak256("AgentPayment(uint256,address,address,uint256,bytes32,bytes32)");
    // FulfillmentReceipt(uint256 indexed orderId, address indexed provider, bytes32 resultHash, bytes32 serviceId, bytes32 transactionRef)
    bytes32 public constant FULFILLMENT_RECEIPT_EVENT_SIGNATURE =
        keccak256("FulfillmentReceipt(uint256,address,bytes32,bytes32,bytes32)");

    enum Actions {
        Payment, // 0
        Fulfillment // 1
    }

    // ------------------------------------------------------------------ //
    //  Verification state (read by SettlementEngine)                     //
    // ------------------------------------------------------------------ //
    mapping(uint256 => bool) public paymentsVerified;
    mapping(uint256 => uint256) public verifiedPaymentAmounts;
    mapping(uint256 => bytes32) public verifiedServiceId;
    mapping(uint256 => address) public verifiedAgent;
    mapping(uint256 => address) public verifiedProvider;
    mapping(uint256 => bool) public fulfillmentsVerified;
    mapping(uint256 => bytes32) public verifiedResultHash;

    /// The single source-chain contract allowed to emit the events we act on.
    /// Only events emitted by this address are accepted (see EvmV1Decoder usage).
    address public veilSource;

    error InvalidAction(uint8 action);
    error InvalidAddress();
    error SourceContractNotRegistered();
    error SourceContractMismatch();
    error UnsupportedTransactionType();
    error TransactionFailed();

    event SourceContractRegistered(address indexed veilSource);
    event PaymentVerified(uint256 indexed orderId, address indexed agent, address indexed provider, uint256 amount, bytes32 serviceId, bytes32 queryId);
    event FulfillmentVerified(uint256 indexed orderId, address indexed provider, bytes32 resultHash, bytes32 queryId);
    event QueryProcessed(bytes32 indexed queryId, uint8 indexed action);

    constructor() Ownable(msg.sender) {
        VERIFIER = NativeQueryVerifierLib.getVerifier();
    }

    /// @dev Owner registers the source-chain VeilSource contract whose events we trust.
    function registerVeilSource(address source) external onlyOwner {
        if (source == address(0)) revert InvalidAddress();
        veilSource = source;
        emit SourceContractRegistered(source);
    }

    // ------------------------------------------------------------------ //
    //  Verified USCBase entry point                                      //
    // ------------------------------------------------------------------ //
    /// @notice Verifies an Attestcoin proof and executes the cross-chain action.
    /// @param action 0 = AgentPayment verification, 1 = FulfillmentReceipt verification.
    /// @param chainKey Source chain key on Creditcoin (Sepolia = 1 on CC3 Testnet).
    /// @param blockHeight Source block containing the transaction.
    /// @param encodedTransaction ABI-encoded source transaction (from usc-sdk txBytes).
    /// @param merkleRoot Merkle root of the transaction tree.
    /// @param siblings Merkle proof siblings.
    /// @param lowerEndpointDigest Continuity proof lower endpoint digest.
    /// @param continuityRoots Continuity proof merkle roots.
    function execute(
        uint8 action,
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (bool success) {
        bytes32 queryId = _computeQueryId(chainKey, blockHeight, merkleRoot, siblings);

        if (processedQueries[queryId]) revert();
        // Marked before verification is intentional: if _verifyProof reverts the
        // whole call (state rolled back), so a failed submission can never be
        // blocked by a half-consumed queryId. Only succeeded proofs stay marked.
        processedQueries[queryId] = true;

        bool verified = _verifyProof(
            chainKey, blockHeight, encodedTransaction, merkleRoot, siblings, lowerEndpointDigest, continuityRoots
        );
        if (!verified) revert();

        _processAndEmitEvent(action, queryId, encodedTransaction);

        emit QueryProcessed(queryId, action);
        return true;
    }

    // ------------------------------------------------------------------ //
    //  Proof verification (precompile)                                   //
    // ------------------------------------------------------------------ //
    function _verifyProof(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) internal returns (bool) {
        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});

        INativeQueryVerifier.ContinuityProof memory continuityProof =
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots});

        return VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof);
    }

    function _computeQueryId(
        uint64 chainKey,
        uint64 blockHeight,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings
    ) internal view returns (bytes32) {
        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});

        uint256 txIndex = VERIFIER.calculateTxIndex(merkleProof);

        bytes32 queryId;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, chainKey)
            mstore(add(ptr, 32), shl(192, blockHeight))
            mstore(add(ptr, 40), txIndex)
            queryId := keccak256(ptr, 72)
        }
        return queryId;
    }

    // ------------------------------------------------------------------ //
    //  Action dispatch                                                   //
    // ------------------------------------------------------------------ //
    function _processAndEmitEvent(uint8 action, bytes32 queryId, bytes memory encodedTransaction) internal {
        if (action == uint8(Actions.Payment)) {
            _processPayment(queryId, encodedTransaction);
        } else if (action == uint8(Actions.Fulfillment)) {
            _processFulfillment(queryId, encodedTransaction);
        } else {
            revert InvalidAction(action);
        }
    }

    function _processPayment(bytes32 queryId, bytes memory encodedTransaction) internal {
        EvmV1Decoder.LogEntry[] memory logs = _validateTransactionContents(
            encodedTransaction, AGENT_PAYMENT_EVENT_SIGNATURE
        );

        EvmV1Decoder.LogEntry memory log = logs[0];
        if (log.topics.length != 4) revert();

        uint256 orderId = uint256(log.topics[1]);
        address agent = address(uint160(uint256(log.topics[2])));
        address provider = address(uint160(uint256(log.topics[3])));

        (uint256 amount, bytes32 serviceId, bytes32 transactionRef) = abi.decode(log.data, (uint256, bytes32, bytes32));

        paymentsVerified[orderId] = true;
        verifiedPaymentAmounts[orderId] = amount;
        verifiedServiceId[orderId] = serviceId;
        verifiedAgent[orderId] = agent;
        verifiedProvider[orderId] = provider;

        emit PaymentVerified(orderId, agent, provider, amount, serviceId, queryId);
    }

    function _processFulfillment(bytes32 queryId, bytes memory encodedTransaction) internal {
        EvmV1Decoder.LogEntry[] memory logs = _validateTransactionContents(
            encodedTransaction, FULFILLMENT_RECEIPT_EVENT_SIGNATURE
        );

        EvmV1Decoder.LogEntry memory log = logs[0];
        if (log.topics.length != 3) revert();

        uint256 orderId = uint256(log.topics[1]);
        address provider = address(uint160(uint256(log.topics[2])));

        (bytes32 resultHash, bytes32 serviceId, bytes32 txRef) = abi.decode(log.data, (bytes32, bytes32, bytes32));

        fulfillmentsVerified[orderId] = true;
        verifiedResultHash[orderId] = resultHash;

        emit FulfillmentVerified(orderId, provider, resultHash, queryId);
    }

    /// @dev Validates a decoded transaction and returns matching event logs.
    ///      Throws unless: tx type is supported, receipt succeeded (status==1),
    ///      the event exists, and it was emitted by the registered VeilSource.
    function _validateTransactionContents(
        bytes memory encodedTransaction,
        bytes32 eventSignature
    ) internal view returns (EvmV1Decoder.LogEntry[] memory) {
        if (veilSource == address(0)) revert SourceContractNotRegistered();

        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        if (!EvmV1Decoder.isValidTransactionType(txType)) revert UnsupportedTransactionType();

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) revert TransactionFailed();

        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(receipt, eventSignature);
        if (logs.length == 0 || logs[0].address_ != veilSource) revert SourceContractMismatch();

        return logs;
    }

    // ------------------------------------------------------------------ //
    //  IAttestationReceiver view                                         //
    // ------------------------------------------------------------------ //
    function isPaymentVerified(uint256 orderId) external view returns (bool) {
        return paymentsVerified[orderId];
    }

    function isFulfillmentVerified(uint256 orderId) external view returns (bool) {
        return fulfillmentsVerified[orderId];
    }

    function verifiedPaymentAmount(uint256 orderId) external view returns (uint256) {
        return verifiedPaymentAmounts[orderId];
    }

    function verifiedServiceIdOf(uint256 orderId) external view returns (bytes32) {
        return verifiedServiceId[orderId];
    }

    function verifiedAgentOf(uint256 orderId) external view returns (address) {
        return verifiedAgent[orderId];
    }

    function verifiedProviderOf(uint256 orderId) external view returns (address) {
        return verifiedProvider[orderId];
    }
}