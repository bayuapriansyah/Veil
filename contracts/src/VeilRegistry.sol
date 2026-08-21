// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {OwnableLite} from "./OwnableLite.sol";

/**
 * VeilRegistry — on-chain agent registry for A2A discovery.
 *
 * Agents self-register with their A2A endpoint URL and optional metadata.
 * Agent A discovers active agents by querying the registry on-chain.
 *
 * Access control:
 *   - registerAgent(): permissionless (anyone can register)
 *   - revokeAgent(): only the agent owner
 *   - updateReputationRef(): only protocol admin (owner)
 *   - healthCheck(): only the agent owner
 */
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
        string endpoint;        // A2A server URL (e.g., "http://127.0.0.1:8081")
        string agentCardHash;   // URI or IPFS hash to full Agent Card
        uint256 registeredAt;   // block.timestamp of registration
        uint256 lastHealthCheck;
    }

    uint256 public nextAgentId = 1;
    mapping(uint256 => Agent) private _agents;
    uint256 public activeAgentCount;
    mapping(uint256 => bool) private _isActive;

    error AgentNotFound();
    error NotAgentOwner();
    error AgentNotActive();
    error EmptyEndpoint();

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string endpoint);
    event AgentRevoked(uint256 indexed agentId);
    event ReputationReferenceUpdated(uint256 indexed agentId, bytes32 reputationRef);
    event AgentHealthChecked(uint256 indexed agentId, uint256 timestamp);
    event EndpointUpdated(uint256 indexed agentId, string endpoint);

    function registerAgent(
        string calldata endpoint,
        string calldata agentCardHash,
        bytes32 reputationRef
    ) external returns (uint256 agentId) {
        if (bytes(endpoint).length == 0) revert EmptyEndpoint();
        agentId = nextAgentId++;
        _agents[agentId] = Agent({
            owner: msg.sender,
            status: AgentStatus.Active,
            reputationRef: reputationRef,
            endpoint: endpoint,
            agentCardHash: agentCardHash,
            registeredAt: block.timestamp,
            lastHealthCheck: block.timestamp
        });
        _isActive[agentId] = true;
        activeAgentCount++;
        emit AgentRegistered(agentId, msg.sender, endpoint);
    }

    function revokeAgent(uint256 agentId) external {
        Agent storage agent = _agents[agentId];
        if (agent.owner == address(0)) revert AgentNotFound();
        if (agent.owner != msg.sender) revert NotAgentOwner();
        agent.status = AgentStatus.Revoked;
        if (_isActive[agentId]) {
            _isActive[agentId] = false;
            activeAgentCount--;
        }
        emit AgentRevoked(agentId);
    }

    function healthCheck(uint256 agentId) external {
        Agent storage agent = _agents[agentId];
        if (agent.owner == address(0)) revert AgentNotFound();
        if (agent.owner != msg.sender) revert NotAgentOwner();
        agent.lastHealthCheck = block.timestamp;
        emit AgentHealthChecked(agentId, block.timestamp);
    }

    function updateEndpoint(uint256 agentId, string calldata endpoint) external {
        Agent storage agent = _agents[agentId];
        if (agent.owner == address(0)) revert AgentNotFound();
        if (agent.owner != msg.sender) revert NotAgentOwner();
        if (bytes(endpoint).length == 0) revert EmptyEndpoint();
        agent.endpoint = endpoint;
        emit EndpointUpdated(agentId, endpoint);
    }

    function updateReputationRef(uint256 agentId, bytes32 reputationRef) external onlyOwner {
        Agent storage agent = _agents[agentId];
        if (agent.owner == address(0)) revert AgentNotFound();
        agent.reputationRef = reputationRef;
        emit ReputationReferenceUpdated(agentId, reputationRef);
    }

    // --- View functions --- //

    function agentOwner(uint256 agentId) external view returns (address) {
        return _agents[agentId].owner;
    }

    function agentStatus(uint256 agentId) external view returns (AgentStatus) {
        return _agents[agentId].status;
    }

    function reputationRef(uint256 agentId) external view returns (bytes32) {
        return _agents[agentId].reputationRef;
    }

    function getAgentEndpoint(uint256 agentId) external view returns (string memory) {
        return _agents[agentId].endpoint;
    }

    function getAgentCardHash(uint256 agentId) external view returns (string memory) {
        return _agents[agentId].agentCardHash;
    }

    function getAgentRegisteredAt(uint256 agentId) external view returns (uint256) {
        return _agents[agentId].registeredAt;
    }

    function getAgentLastHealthCheck(uint256 agentId) external view returns (uint256) {
        return _agents[agentId].lastHealthCheck;
    }

    function isAgentActive(uint256 agentId) external view returns (bool) {
        return _isActive[agentId];
    }

    function requireActiveAgent(uint256 agentId) external view {
        Agent storage agent = _agents[agentId];
        if (agent.owner == address(0)) revert AgentNotFound();
        if (agent.status != AgentStatus.Active) revert AgentNotActive();
    }

    /**
     * Returns all active agent IDs. Bounded by nextAgentId - 1.
     * For demo purposes (small number of agents). Production would use
     * pagination or events.
     */
    function listActiveAgents() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i < nextAgentId; i++) {
            if (_isActive[i]) count++;
        }
        uint256[] memory ids = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 1; i < nextAgentId; i++) {
            if (_isActive[i]) {
                ids[idx++] = i;
            }
        }
        return ids;
    }

    /**
     * Returns full agent data for a given agent ID.
     */
    function getAgent(uint256 agentId) external view returns (
        address owner,
        AgentStatus status,
        bytes32 reputationRef,
        string memory endpoint,
        string memory agentCardHash,
        uint256 registeredAt,
        uint256 lastHealthCheck
    ) {
        Agent storage agent = _agents[agentId];
        if (agent.owner == address(0)) revert AgentNotFound();
        return (
            agent.owner,
            agent.status,
            agent.reputationRef,
            agent.endpoint,
            agent.agentCardHash,
            agent.registeredAt,
            agent.lastHealthCheck
        );
    }
}
