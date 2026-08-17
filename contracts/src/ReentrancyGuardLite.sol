// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

abstract contract ReentrancyGuardLite {
    uint256 private _locked = 1;

    error ReentrantCall();

    modifier nonReentrant() {
        if (_locked != 1) revert ReentrantCall();
        _locked = 2;
        _;
        _locked = 1;
    }
}
