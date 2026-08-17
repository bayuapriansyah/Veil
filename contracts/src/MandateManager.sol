// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {OwnableLite} from "./OwnableLite.sol";

contract MandateManager is OwnableLite {
    enum MandateState {
        None,
        Active,
        Revoked
    }

    struct Mandate {
        address owner;
        uint256 agentId;
        uint256 budget;
        uint256 spent;
        bytes32 allowedService;
        uint64 expiration;
        MandateState state;
    }

    uint256 public nextMandateId = 1;
    address public settlementEngine;
    mapping(uint256 => Mandate) private _mandates;

    error InvalidBudget();
    error InvalidExpiration();
    error MandateNotFound();
    error NotMandateOwner();
    error MandateNotActive();
    error MandateExpired();
    error ServiceNotAllowed();
    error BudgetExceeded();
    error SettlementEngineNotSet();

    event MandateCreated(uint256 indexed mandateId, address indexed owner, uint256 indexed agentId, uint256 budget, bytes32 allowedService, uint64 expiration);
    event MandateRevoked(uint256 indexed mandateId, address indexed owner);
    event SpendRecorded(uint256 indexed mandateId, uint256 amount, uint256 spent);
    event SettlementEngineSet(address indexed settlementEngine);

    modifier onlySettlementEngine() {
        if (msg.sender != settlementEngine) revert Unauthorized();
        _;
    }

    function setSettlementEngine(address engine) external onlyOwner {
        if (engine == address(0)) revert ZeroAddress();
        settlementEngine = engine;
        emit SettlementEngineSet(engine);
    }

    function createMandate(uint256 agentId, uint256 budget, bytes32 allowedService, uint64 expiration) external returns (uint256 mandateId) {
        if (budget == 0) revert InvalidBudget();
        if (expiration <= block.timestamp) revert InvalidExpiration();
        mandateId = nextMandateId++;
        _mandates[mandateId] = Mandate({owner: msg.sender, agentId: agentId, budget: budget, spent: 0, allowedService: allowedService, expiration: expiration, state: MandateState.Active});
        emit MandateCreated(mandateId, msg.sender, agentId, budget, allowedService, expiration);
    }

    function revokeMandate(uint256 mandateId) external {
        Mandate storage mandate = _mandates[mandateId];
        if (mandate.owner == address(0)) revert MandateNotFound();
        if (mandate.owner != msg.sender) revert NotMandateOwner();
        mandate.state = MandateState.Revoked;
        emit MandateRevoked(mandateId, msg.sender);
    }

    function isMandateValid(uint256 mandateId, bytes32 serviceId, uint256 amount) public view returns (bool) {
        Mandate storage mandate = _mandates[mandateId];
        if (mandate.owner == address(0)) return false;
        if (mandate.state != MandateState.Active) return false;
        if (block.timestamp > mandate.expiration) return false;
        if (mandate.allowedService != serviceId) return false;
        return remainingBudget(mandateId) >= amount;
    }

    function remainingBudget(uint256 mandateId) public view returns (uint256) {
        Mandate storage mandate = _mandates[mandateId];
        if (mandate.budget <= mandate.spent) return 0;
        return mandate.budget - mandate.spent;
    }

    function recordSpend(uint256 mandateId, uint256 amount) external onlySettlementEngine {
        if (settlementEngine == address(0)) revert SettlementEngineNotSet();
        Mandate storage mandate = _mandates[mandateId];
        if (mandate.owner == address(0)) revert MandateNotFound();
        if (mandate.state != MandateState.Active) revert MandateNotActive();
        if (block.timestamp > mandate.expiration) revert MandateExpired();
        if (remainingBudget(mandateId) < amount) revert BudgetExceeded();
        mandate.spent += amount;
        emit SpendRecorded(mandateId, amount, mandate.spent);
    }

    function mandateOwner(uint256 mandateId) external view returns (address) {
        return _mandates[mandateId].owner;
    }

    function agentIdOf(uint256 mandateId) external view returns (uint256) {
        return _mandates[mandateId].agentId;
    }

    function budgetOf(uint256 mandateId) external view returns (uint256) {
        return _mandates[mandateId].budget;
    }

    function spentOf(uint256 mandateId) external view returns (uint256) {
        return _mandates[mandateId].spent;
    }

    function allowedServiceOf(uint256 mandateId) external view returns (bytes32) {
        return _mandates[mandateId].allowedService;
    }

    function expirationOf(uint256 mandateId) external view returns (uint64) {
        return _mandates[mandateId].expiration;
    }

    function stateOf(uint256 mandateId) external view returns (MandateState) {
        return _mandates[mandateId].state;
    }
}
