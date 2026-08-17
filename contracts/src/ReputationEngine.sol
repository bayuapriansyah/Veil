// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {OwnableLite} from "./OwnableLite.sol";

contract ReputationEngine is OwnableLite {
    struct Reputation {
        uint256 successfulSettlements;
        uint256 failedSettlements;
        uint256 refunds;
        uint256 policyViolations;
    }

    address public settlementEngine;
    mapping(address => Reputation) private _reputation;

    event SettlementEngineSet(address indexed settlementEngine);
    event SettlementSuccessRecorded(address indexed account, uint256 total);
    event SettlementFailureRecorded(address indexed account, uint256 total);
    event RefundRecorded(address indexed account, uint256 total);
    event PolicyViolationRecorded(address indexed account, uint256 total);

    modifier onlySettlementEngine() {
        if (msg.sender != settlementEngine) revert Unauthorized();
        _;
    }

    function setSettlementEngine(address engine) external onlyOwner {
        if (engine == address(0)) revert ZeroAddress();
        settlementEngine = engine;
        emit SettlementEngineSet(engine);
    }

    function recordSettlementSuccess(address account) external onlySettlementEngine {
        _reputation[account].successfulSettlements += 1;
        emit SettlementSuccessRecorded(account, _reputation[account].successfulSettlements);
    }

    function recordSettlementFailure(address account) external onlySettlementEngine {
        _reputation[account].failedSettlements += 1;
        emit SettlementFailureRecorded(account, _reputation[account].failedSettlements);
    }

    function recordRefund(address account) external onlySettlementEngine {
        _reputation[account].refunds += 1;
        emit RefundRecorded(account, _reputation[account].refunds);
    }

    function recordPolicyViolation(address account) external onlySettlementEngine {
        _reputation[account].policyViolations += 1;
        emit PolicyViolationRecorded(account, _reputation[account].policyViolations);
    }

    function reputationOf(address account) external view returns (Reputation memory) {
        return _reputation[account];
    }
}
