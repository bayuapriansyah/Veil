// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IMandateManager {
    function mandateOwner(uint256 mandateId) external view returns (address);
    function agentIdOf(uint256 mandateId) external view returns (uint256);
    function isMandateValid(uint256 mandateId, bytes32 serviceId, uint256 amount) external view returns (bool);
    function remainingBudget(uint256 mandateId) external view returns (uint256);
    function recordSpend(uint256 mandateId, uint256 amount) external;
}
