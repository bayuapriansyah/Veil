// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title VeilSource
/// @notice Source-chain contract for VEIL, deployed on a chain supported by
///         Attestcoin Protocol Readability (CC3 Testnet: Ethereum Sepolia).
/// @dev    Kept intentionally minimal per the verified Attestcoin best practices:
///         source contracts only hold minimal logic and emit events. The events
///         below are what the off-chain worker proves on Creditcoin.
contract VeilSource is Ownable, ReentrancyGuard {
    // ------------------------------------------------------------------ //
    //  Events consumed by the Attestcoin Protocol                         //
    // ------------------------------------------------------------------ //
    // 3 indexed params (max allowed for filtering). Remaining fields are
    // carried in `data` and decoded on Creditcoin via EvmV1Decoder.
    //
    // event AgentPayment(
    //     uint256 indexed orderId,
    //     address indexed agent,
    //     address indexed provider,
    //     uint256 amount,          // data
    //     bytes32 serviceId,       // data
    //     bytes32 transactionRef); // data
    event AgentPayment(
        uint256 indexed orderId,
        address indexed agent,
        address indexed provider,
        uint256 amount,
        bytes32 serviceId,
        bytes32 transactionRef
    );

    event FulfillmentReceipt(
        uint256 indexed orderId,
        address indexed provider,
        bytes32 resultHash,
        bytes32 serviceId,
        bytes32 transactionRef
    );

    // ------------------------------------------------------------------ //
    //  State (minimal by design)                                          //
    // ------------------------------------------------------------------ //
    mapping(uint256 => address) public orderPaidBy;
    mapping(uint256 => address) public orderProvider;

    error NotFound();
    error OrderAlreadyPaid();
    error PaymentNotRecorded();
    error InvalidAmount();
    error InvalidAddress();
    error NotProvider();

    constructor() Ownable(msg.sender) {}

    /// @notice Records a payment made by an agent for a service order and
    ///         emits the AgentPayment event that Attestcoin will prove on Creditcoin.
    /// @param orderId Unique order id (shared with the Creditcoin side).
    /// @param provider Address of the service provider receiving payment.
    /// @param amount Amount paid in the source-chain settlement asset.
    /// @param serviceId Identifier of the service/category being purchased.
    /// @param transactionRef Off-chain reference (e.g. x402 request id).
    function recordAgentPayment(
        uint256 orderId,
        address provider,
        uint256 amount,
        bytes32 serviceId,
        bytes32 transactionRef
    ) external {
        if (amount == 0) revert InvalidAmount();
        if (provider == address(0)) revert InvalidAddress();
        if (orderPaidBy[orderId] != address(0)) revert OrderAlreadyPaid();

        orderPaidBy[orderId] = msg.sender;
        orderProvider[orderId] = provider;

        emit AgentPayment(orderId, msg.sender, provider, amount, serviceId, transactionRef);
    }

    /// @notice Records a fulfillment by the provider and emits the FulfillmentReceipt
    ///         event that Attestcoin will prove on Creditcoin. Only the provider that
    ///         was paid (per the recorded payment) may call this.
    /// @param orderId Unique order id.
    /// @param resultHash Hash of the fulfillment evidence (off-chain payload hash).
    /// @param serviceId Identifier of the service/category delivered.
    /// @param transactionRef Reference matching the original AgentPayment.
    function recordFulfillment(
        uint256 orderId,
        bytes32 resultHash,
        bytes32 serviceId,
        bytes32 transactionRef
    ) external {
        if (orderProvider[orderId] == address(0)) revert NotFound();
        if (orderProvider[orderId] != msg.sender) revert NotProvider();

        emit FulfillmentReceipt(orderId, msg.sender, resultHash, serviceId, transactionRef);
    }

    /// @notice Whether an order has been paid (per this source contract).
    function isOrderPaid(uint256 orderId) external view returns (bool) {
        return orderPaidBy[orderId] != address(0);
    }
}