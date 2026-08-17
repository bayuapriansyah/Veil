// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {OwnableLite} from "./OwnableLite.sol";
import {ReentrancyGuardLite} from "./ReentrancyGuardLite.sol";
import {IEscrowManager} from "./interfaces/IEscrowManager.sol";

contract EscrowManager is OwnableLite, ReentrancyGuardLite, IEscrowManager {
    struct Escrow {
        address payer;
        address payable provider;
        uint256 mandateId;
        uint256 amount;
        EscrowStatus status;
    }

    address public settlementEngine;
    mapping(uint256 => Escrow) private _escrows;

    error EscrowExists();
    error EscrowNotFound();
    error InvalidAmount();
    error InvalidProvider();
    error InvalidStatus();
    error IncorrectValue();

    event SettlementEngineSet(address indexed settlementEngine);
    event EscrowCreated(uint256 indexed orderId, uint256 indexed mandateId, address indexed payer, address provider, uint256 amount);
    event EscrowReleased(uint256 indexed orderId, address indexed provider, uint256 amount);
    event EscrowRefunded(uint256 indexed orderId, address indexed payer, uint256 amount);

    modifier onlySettlementEngine() {
        if (msg.sender != settlementEngine) revert Unauthorized();
        _;
    }

    function setSettlementEngine(address engine) external onlyOwner {
        if (engine == address(0)) revert ZeroAddress();
        settlementEngine = engine;
        emit SettlementEngineSet(engine);
    }

    function createEscrow(uint256 orderId, uint256 mandateId, address payable provider) external payable nonReentrant {
        if (_escrows[orderId].status != EscrowStatus.None) revert EscrowExists();
        if (msg.value == 0) revert InvalidAmount();
        if (provider == address(0)) revert InvalidProvider();
        _escrows[orderId] = Escrow({payer: msg.sender, provider: provider, mandateId: mandateId, amount: msg.value, status: EscrowStatus.Locked});
        emit EscrowCreated(orderId, mandateId, msg.sender, provider, msg.value);
    }

    function release(uint256 orderId) external onlySettlementEngine nonReentrant {
        Escrow storage escrow = _escrows[orderId];
        if (escrow.status == EscrowStatus.None) revert EscrowNotFound();
        if (escrow.status != EscrowStatus.Locked) revert InvalidStatus();
        escrow.status = EscrowStatus.Released;
        uint256 amount = escrow.amount;
        address payable provider = escrow.provider;
        (bool ok,) = provider.call{value: amount}("");
        if (!ok) revert IncorrectValue();
        emit EscrowReleased(orderId, provider, amount);
    }

    function refund(uint256 orderId) external nonReentrant {
        Escrow storage escrow = _escrows[orderId];
        if (escrow.status == EscrowStatus.None) revert EscrowNotFound();
        if (escrow.status != EscrowStatus.Locked) revert InvalidStatus();
        if (msg.sender != escrow.payer && msg.sender != settlementEngine) revert Unauthorized();
        escrow.status = EscrowStatus.Refunded;
        uint256 amount = escrow.amount;
        address payable payer = payable(escrow.payer);
        (bool ok,) = payer.call{value: amount}("");
        if (!ok) revert IncorrectValue();
        emit EscrowRefunded(orderId, payer, amount);
    }

    function escrowAmount(uint256 orderId) external view returns (uint256) {
        return _escrows[orderId].amount;
    }

    function escrowProvider(uint256 orderId) external view returns (address) {
        return _escrows[orderId].provider;
    }

    function escrowMandate(uint256 orderId) external view returns (uint256) {
        return _escrows[orderId].mandateId;
    }

    function escrowStatus(uint256 orderId) external view returns (EscrowStatus) {
        return _escrows[orderId].status;
    }

    function escrowPayer(uint256 orderId) external view returns (address) {
        return _escrows[orderId].payer;
    }
}
