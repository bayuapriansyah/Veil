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

contract MockAttestationReceiver is IAttestationReceiver {
    mapping(uint256 => bool) public payments;
    mapping(uint256 => bool) public fulfillments;
    mapping(uint256 => uint256) public amounts;
    mapping(uint256 => bytes32) public services;
    mapping(uint256 => address) public agents;
    mapping(uint256 => address) public providers;

    function setPayment(uint256 orderId, uint256 amount, bytes32 serviceId) external {
        payments[orderId] = true;
        amounts[orderId] = amount;
        services[orderId] = serviceId;
    }

    function setParties(uint256 orderId, address agent, address provider) external {
        agents[orderId] = agent;
        providers[orderId] = provider;
    }

    function setFulfillment(uint256 orderId) external {
        fulfillments[orderId] = true;
    }

    function isPaymentVerified(uint256 orderId) external view returns (bool) {
        return payments[orderId];
    }

    function isFulfillmentVerified(uint256 orderId) external view returns (bool) {
        return fulfillments[orderId];
    }

    function verifiedPaymentAmount(uint256 orderId) external view returns (uint256) {
        return amounts[orderId];
    }

    function verifiedServiceIdOf(uint256 orderId) external view returns (bytes32) {
        return services[orderId];
    }

    function verifiedAgentOf(uint256 orderId) external view returns (address) {
        return agents[orderId];
    }

    function verifiedProviderOf(uint256 orderId) external view returns (address) {
        return providers[orderId];
    }
}

contract VeilFoundationTest is Test {
    bytes32 internal constant SERVICE = keccak256("market-data");
    bytes32 internal constant OTHER_SERVICE = keccak256("compute");

    address internal user = address(0xA11CE);
    address payable internal provider = payable(address(0xB0B));
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
        settlement = new SettlementEngine(mandates, escrows, attestations, reputation);
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
        escrows.createEscrow{value: amount}(orderId, mandateId, provider);
        attestations.setParties(orderId, user, provider);
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
        _createEscrow(orderId, mandateId, 2 ether);
        attestations.setPayment(orderId, 2 ether, SERVICE);
        attestations.setFulfillment(orderId);
        uint256 providerBefore = provider.balance;
        vm.prank(operator);
        settlement.settle(orderId);
        assertEq(provider.balance, providerBefore + 2 ether);
        assertEq(uint256(escrows.escrowStatus(orderId)), uint256(IEscrowManager.EscrowStatus.Released));
        assertEq(mandates.remainingBudget(mandateId), 8 ether);
    }

    function testFailedFulfillment() public {
        uint256 mandateId = _createMandate(10 ether, uint64(block.timestamp + 1 days));
        uint256 orderId = 102;
        _createEscrow(orderId, mandateId, 2 ether);
        attestations.setPayment(orderId, 2 ether, SERVICE);
        vm.prank(operator);
        vm.expectRevert();
        settlement.settle(orderId);
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
        _createEscrow(orderId, mandateId, 2 ether);
        attestations.setPayment(orderId, 2 ether, SERVICE);
        attestations.setFulfillment(orderId);
        vm.prank(stranger);
        vm.expectRevert();
        settlement.settle(orderId);
    }

    function testServiceMismatchBlocksSettlement() public {
        uint256 mandateId = _createMandate(10 ether, uint64(block.timestamp + 1 days));
        uint256 orderId = 105;
        _createEscrow(orderId, mandateId, 2 ether);
        attestations.setPayment(orderId, 2 ether, OTHER_SERVICE);
        attestations.setFulfillment(orderId);
        vm.prank(operator);
        vm.expectRevert();
        settlement.settle(orderId);
    }

    function testRevokedMandateBlocksSettlementKillSwitch() public {
        uint256 mandateId = _createMandate(10 ether, uint64(block.timestamp + 1 days));
        uint256 orderId = 106;
        _createEscrow(orderId, mandateId, 2 ether);
        vm.prank(user);
        mandates.revokeMandate(mandateId);
        attestations.setPayment(orderId, 2 ether, SERVICE);
        attestations.setFulfillment(orderId);
        vm.prank(operator);
        vm.expectRevert();
        settlement.settle(orderId);
    }
}