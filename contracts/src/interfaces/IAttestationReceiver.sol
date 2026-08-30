// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IAttestationReceiver {
    function isPaymentVerified(uint256 orderId) external view returns (bool);
    function isFulfillmentVerified(uint256 orderId) external view returns (bool);
    function verifiedPaymentAmount(uint256 orderId) external view returns (uint256);
    function verifiedServiceIdOf(uint256 orderId) external view returns (bytes32);
    function verifiedAgentOf(uint256 orderId) external view returns (address);
    function verifiedProviderOf(uint256 orderId) external view returns (address);
    function isZKReceiptVerified(uint256 orderId) external view returns (bool);
    function verifiedZKProofHashOf(uint256 orderId) external view returns (bytes32);
}
