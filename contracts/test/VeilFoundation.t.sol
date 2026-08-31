// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {VeilRegistry} from "../src/VeilRegistry.sol";
import {MandateManager} from "../src/MandateManager.sol";
import {EscrowManager} from "../src/EscrowManager.sol";
import {SettlementEngine} from "../src/SettlementEngine.sol";
import {ReputationEngine} from "../src/ReputationEngine.sol";
import {IAttestationReceiver} from "../src/interfaces/IAttestationReceiver.sol";
import {IEscrowManager} from "../src/interfaces/IEscrowManager.sol";
import {IMandateManager} from "../src/interfaces/IMandateManager.sol";

contract MockAttestationReceiver is IAttestationReceiver {
    mapping(uint256 => bool) public payments;
    mapping(uint256 => bool) public fulfillments;
    mapping(uint256 => bool) public zkReceipts;
    mapping(uint256 => bytes32) public commitments;
    mapping(uint256 => address) public agents;
    mapping(uint256 => bytes32) public zkProofHashes;

    function setPayment(uint256 orderId) external {
        payments[orderId] = true;
    }

    function setCommitment(uint256 orderId, bytes32 commitment) external {
        commitments[orderId] = commitment;
    }

    function setParties(uint256 orderId, address agent) external {
        agents[orderId] = agent;
    }

    function setFulfillment(uint256 orderId) external {
        fulfillments[orderId] = true;
    }

    function setZKReceipt(uint256 orderId) external {
        zkReceipts[orderId] = true;
        zkProofHashes[orderId] = keccak256(abi.encodePacked(orderId, "zkproof"));
    }

    function isPaymentVerified(uint256 orderId) external view returns (bool) {
        return payments[orderId];
    }

    function isFulfillmentVerified(uint256 orderId) external view returns (bool) {
        return fulfillments[orderId];
    }

    function verifiedCommitmentOf(uint256 orderId) external view returns (bytes32) {
        return commitments[orderId];
    }

    function verifiedAgentOf(uint256 orderId) external view returns (address) {
        return agents[orderId];
    }

    function isZKReceiptVerified(uint256 orderId) external view returns (bool) {
        return zkReceipts[orderId];
    }

    function verifiedZKProofHashOf(uint256 orderId) external view returns (bytes32) {
        return zkProofHashes[orderId];
    }
}

contract VeilFoundationTest is Test {
    bytes32 internal constant SERVICE = keccak256("market-data");
    bytes32 internal constant OTHER_SERVICE = keccak256("compute");
    bytes32 internal constant SALT = bytes32(uint256(0xABCD));

    address internal user = address(0xA11CE);
    address payable internal provider_ = payable(address(0xB0B));
    address internal operator = address(0x0A0A);
    address internal stranger = address(0xBAD);

    VeilRegistry internal registry;
    MandateManager internal mandates;
    EscrowManager internal escrows;
    ReputationEngine internal reputation;
    SettlementEngine internal settlement;
    MockAttestationReceiver internal attestations;

    function setUp() public {
        registry = new VeilRegistry();
        mandates = new MandateManager();
        escrows = new EscrowManager();
        reputation = new ReputationEngine();
        attestations = new MockAttestationReceiver();
        settlement = new SettlementEngine(IMandateManager(address(mandates)), IEscrowManager(address(escrows)), attestations, reputation);
        mandates.setSettlementEngine(address(settlement));
        escrows.setSettlementEngine(address(settlement));
        reputation.setSettlementEngine(address(settlement));
        settlement.setSettlementOperator(operator);
        vm.deal(user, 100 ether);
    }

    function _createMandate(uint256 budget, uint64 expiration) internal returns (uint256 mandateId) {
        vm.prank(user);
        mandateId = mandates.createMandate(1, budget, SERVICE, expiration);
    }

    function _createEscrow(uint256 orderId, uint256 mandateId, uint256 amount) internal {
        vm.prank(user);
        escrows.createEscrow{value: amount}(orderId, mandateId, provider_);
        attestations.setParties(orderId, user);
    }

    function _computeCommitment(address addr, uint256 amount, bytes32 serviceId, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(addr, amount, serviceId, salt));
    }

    function testValidMandate() public {
        uint256 mandateId = _createMandate(10 ether, uint64(block.timestamp + 1 days));
        assertTrue(mandates.isMandateValid(mandateId, SERVICE, 1 ether));
        assertEq(mandates.remainingBudget(mandateId), 10 ether);
        assertEq(mandates.mandateOwner(mandateId), user);
        assertEq(mandates.agentIdOf(mandateId), 1);
    }

    function testExpiredMandate() public {
        uint256 mandateId = _createMandate(10 ether, uint64(block.timestamp + 1 days));
        vm.warp(block.timestamp + 2 days);
        assertFalse(mandates.isMandateValid(mandateId, SERVICE, 1 ether));
    }

    function testRevokedMandate() public {
        uint256 mandateId = _createMandate(10 ether, uint64(block.timestamp + 1 days));
        vm.prank(user);
        mandates.revokeMandate(mandateId);
        assertFalse(mandates.isMandateValid(mandateId, SERVICE, 1 ether));
    }

    function testBudgetExceeded() public {
        uint256 mandateId = _createMandate(1 ether, uint64(block.timestamp + 1 days));
        assertFalse(mandates.isMandateValid(mandateId, SERVICE, 2 ether));
    }

    function testSuccessfulEscrowRelease() public {
        uint256 mandateId = _createMandate(10 ether, uint64(block.timestamp + 1 days));
        uint256 orderId = 101;
        uint256 amount = 2 ether;
        _createEscrow(orderId, mandateId, amount);

        bytes32 commitment = _computeCommitment(provider_, amount, SERVICE, SALT);
        attestations.setPayment(orderId);
        attestations.setCommitment(orderId, commitment);
        attestations.setFulfillment(orderId);
        attestations.setZKReceipt(orderId);

        uint256 providerBefore = provider_.balance;
        vm.prank(operator);
        settlement.settle(orderId, SALT);
        assertEq(provider_.balance, providerBefore + amount);
        assertEq(uint256(escrows.escrowStatus(orderId)), uint256(IEscrowManager.EscrowStatus.Released));
        assertEq(mandates.remainingBudget(mandateId), 8 ether);
    }

    function test_RevertWhen_FulfillmentMissing() public {
        uint256 mandateId = _createMandate(10 ether, uint64(block.timestamp + 1 days));
        uint256 orderId = 102;
        _createEscrow(orderId, mandateId, 2 ether);
        attestations.setPayment(orderId);
        vm.prank(operator);
        vm.expectRevert();
        settlement.settle(orderId, SALT);
        assertEq(uint256(escrows.escrowStatus(orderId)), uint256(IEscrowManager.EscrowStatus.Locked));
    }

    function test_RevertWhen_ZKProofMissing() public {
        uint256 mandateId = _createMandate(10 ether, uint64(block.timestamp + 1 days));
        uint256 orderId = 200;
        _createEscrow(orderId, mandateId, 2 ether);
        attestations.setPayment(orderId);
        attestations.setFulfillment(orderId);
        vm.prank(operator);
        vm.expectRevert();
        settlement.settle(orderId, SALT);
        assertEq(uint256(escrows.escrowStatus(orderId)), uint256(IEscrowManager.EscrowStatus.Locked));
    }

    function testRefund() public {
        uint256 mandateId = _createMandate(10 ether, uint64(block.timestamp + 1 days));
        uint256 orderId = 103;
        _createEscrow(orderId, mandateId, 2 ether);
        uint256 userBefore = user.balance;
        vm.prank(operator);
        settlement.refund(orderId);
        assertEq(user.balance, userBefore + 2 ether);
        assertEq(uint256(escrows.escrowStatus(orderId)), uint256(IEscrowManager.EscrowStatus.Refunded));
    }

    function testUnauthorizedRevoke() public {
        uint256 mandateId = _createMandate(10 ether, uint64(block.timestamp + 1 days));
        vm.prank(stranger);
        vm.expectRevert();
        mandates.revokeMandate(mandateId);
    }

    function testUnauthorizedSettlement() public {
        uint256 mandateId = _createMandate(10 ether, uint64(block.timestamp + 1 days));
        uint256 orderId = 104;
        uint256 amount = 2 ether;
        _createEscrow(orderId, mandateId, amount);

        bytes32 commitment = _computeCommitment(provider_, amount, SERVICE, SALT);
        attestations.setPayment(orderId);
        attestations.setCommitment(orderId, commitment);
        attestations.setFulfillment(orderId);
        attestations.setZKReceipt(orderId);

        vm.prank(stranger);
        vm.expectRevert();
        settlement.settle(orderId, SALT);
    }

    function testCommitmentMismatchBlocksSettlement() public {
        uint256 mandateId = _createMandate(10 ether, uint64(block.timestamp + 1 days));
        uint256 orderId = 105;
        uint256 amount = 2 ether;
        _createEscrow(orderId, mandateId, amount);

        // Set wrong commitment (OTHER_SERVICE instead of SERVICE)
        bytes32 wrongCommitment = _computeCommitment(provider_, amount, OTHER_SERVICE, SALT);
        attestations.setPayment(orderId);
        attestations.setCommitment(orderId, wrongCommitment);
        attestations.setFulfillment(orderId);
        attestations.setZKReceipt(orderId);

        vm.prank(operator);
        vm.expectRevert(SettlementEngine.CommitmentMismatch.selector);
        settlement.settle(orderId, SALT);
    }

    function testRevokedMandateBlocksSettlementKillSwitch() public {
        uint256 mandateId = _createMandate(10 ether, uint64(block.timestamp + 1 days));
        uint256 orderId = 106;
        uint256 amount = 2 ether;
        _createEscrow(orderId, mandateId, amount);
        vm.prank(user);
        mandates.revokeMandate(mandateId);

        bytes32 commitment = _computeCommitment(provider_, amount, SERVICE, SALT);
        attestations.setPayment(orderId);
        attestations.setCommitment(orderId, commitment);
        attestations.setFulfillment(orderId);
        attestations.setZKReceipt(orderId);

        vm.prank(operator);
        vm.expectRevert();
        settlement.settle(orderId, SALT);
    }

    // --- VeilRegistry tests --- //

    function testRegisterAgent() public {
        vm.prank(user);
        uint256 agentId = registry.registerAgent("http://127.0.0.1:8081", "QmHash123", bytes32(0));
        assertEq(agentId, 1);
        assertEq(registry.agentOwner(agentId), user);
        assertEq(uint256(registry.agentStatus(agentId)), uint256(VeilRegistry.AgentStatus.Active));
        assertEq(registry.getAgentEndpoint(agentId), "http://127.0.0.1:8081");
        assertEq(registry.getAgentCardHash(agentId), "QmHash123");
        assertTrue(registry.isAgentActive(agentId));
        assertEq(registry.activeAgentCount(), 1);
    }

    function testRegisterMultipleAgents() public {
        vm.prank(user);
        registry.registerAgent("http://agent1.com", "card1", bytes32(0));
        vm.prank(provider_);
        registry.registerAgent("http://agent2.com", "card2", bytes32(0));
        assertEq(registry.activeAgentCount(), 2);
        uint256[] memory ids = registry.listActiveAgents();
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
    }

    function testRevokeAgent() public {
        vm.prank(user);
        uint256 agentId = registry.registerAgent("http://agent.com", "card", bytes32(0));
        vm.prank(user);
        registry.revokeAgent(agentId);
        assertEq(uint256(registry.agentStatus(agentId)), uint256(VeilRegistry.AgentStatus.Revoked));
        assertFalse(registry.isAgentActive(agentId));
        assertEq(registry.activeAgentCount(), 0);
    }

    function testCannotRevokeOthersAgent() public {
        vm.prank(user);
        uint256 agentId = registry.registerAgent("http://agent.com", "card", bytes32(0));
        vm.prank(stranger);
        vm.expectRevert(VeilRegistry.NotAgentOwner.selector);
        registry.revokeAgent(agentId);
    }

    function testHealthCheck() public {
        vm.prank(user);
        uint256 agentId = registry.registerAgent("http://agent.com", "card", bytes32(0));
        uint256 before = registry.getAgentLastHealthCheck(agentId);
        vm.warp(block.timestamp + 100);
        vm.prank(user);
        registry.healthCheck(agentId);
        assertEq(registry.getAgentLastHealthCheck(agentId), block.timestamp);
        assertTrue(registry.getAgentLastHealthCheck(agentId) > before);
    }

    function testUpdateEndpoint() public {
        vm.prank(user);
        uint256 agentId = registry.registerAgent("http://old.com", "card", bytes32(0));
        vm.prank(user);
        registry.updateEndpoint(agentId, "http://new.com");
        assertEq(registry.getAgentEndpoint(agentId), "http://new.com");
    }

    function testEmptyEndpointReverts() public {
        vm.prank(user);
        vm.expectRevert(VeilRegistry.EmptyEndpoint.selector);
        registry.registerAgent("", "card", bytes32(0));
    }

    function testGetAgent() public {
        vm.prank(user);
        uint256 agentId = registry.registerAgent("http://agent.com", "QmHash", bytes32(uint256(42)));
        (
            address owner,
            VeilRegistry.AgentStatus status,
            bytes32 repRef,
            string memory endpoint,
            string memory cardHash,
            uint256 registeredAt,
            uint256 lastHealthCheck
        ) = registry.getAgent(agentId);
        assertEq(owner, user);
        assertEq(uint256(status), uint256(VeilRegistry.AgentStatus.Active));
        assertEq(repRef, bytes32(uint256(42)));
        assertEq(endpoint, "http://agent.com");
        assertEq(cardHash, "QmHash");
        assertEq(registeredAt, block.timestamp);
        assertEq(lastHealthCheck, block.timestamp);
    }
}
