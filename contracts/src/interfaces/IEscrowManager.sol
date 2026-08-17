// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IEscrowManager {
    enum EscrowStatus {
        None,
        Locked,
        Released,
        Refunded
    }

    function escrowAmount(uint256 orderId) external view returns (uint256);
    function escrowProvider(uint256 orderId) external view returns (address);
    function escrowPayer(uint256 orderId) external view returns (address);
    function escrowMandate(uint256 orderId) external view returns (uint256);
    function escrowStatus(uint256 orderId) external view returns (EscrowStatus);
    function release(uint256 orderId) external;
    function refund(uint256 orderId) external;
}
