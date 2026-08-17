// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {OwnableLite} from "./OwnableLite.sol";

contract VeilRegistry is OwnableLite {
    enum AgentStatus {
        None,
        Active,
        Revoked
    }

    struct Agent {
        address owner;
        AgentStatus status;
        bytes32 reputationRef;
    }

    uint256 public nextAgentId = 1;
    mapping(uint256 => Agent) private _agents;

    error AgentNotFound();
    error NotAgentOwner();
    error AgentNotActive();

    event AgentRegistered(uint256 indexed agentId, address indexed owner, bytes32 reputationRef);
    event AgentRevoked(uint256 indexed agentId);
    event ReputationReferenceUpdated(uint256 indexed agentId, bytes32 reputationRef);

    function registerAgent(bytes32 reputationRef) external returns (uint256 agentId) {
        agentId = nextAgentId++;
        _agents[agentId] = Agent({owner: msg.sender, status: AgentStatus.Active, reputationRef: reputationRef});
        emit AgentRegistered(agentId, msg.sender, reputationRef);
    }

    function revokeAgent(uint256 agentId) external {
        Agent storage agent = _agents[agentId];
        if (agent.owner == address(0)) revert AgentNotFound();
        if (agent.owner != msg.sender) revert NotAgentOwner();
        agent.status = AgentStatus.Revoked;
        emit AgentRevoked(agentId);
    }

    function updateReputationRef(uint256 agentId, bytes32 reputationRef) external onlyOwner {
        Agent storage agent = _agents[agentId];
        if (agent.owner == address(0)) revert AgentNotFound();
        agent.reputationRef = reputationRef;
        emit ReputationReferenceUpdated(agentId, reputationRef);
    }

    function agentOwner(uint256 agentId) external view returns (address) {
        return _agents[agentId].owner;
    }

    function agentStatus(uint256 agentId) external view returns (AgentStatus) {
        return _agents[agentId].status;
    }

    function reputationRef(uint256 agentId) external view returns (bytes32) {
        return _agents[agentId].reputationRef;
    }

    function requireActiveAgent(uint256 agentId) external view {
        Agent storage agent = _agents[agentId];
        if (agent.owner == address(0)) revert AgentNotFound();
        if (agent.status != AgentStatus.Active) revert AgentNotActive();
    }
}
