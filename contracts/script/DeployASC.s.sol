// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "forge-std/Script.sol";
import "../src/AttestationReceiver.sol";

contract DeployASC is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        vm.startBroadcast(pk);
        AttestationReceiver asc = new AttestationReceiver();
        vm.stopBroadcast();
        console.log("AttestationReceiver deployed at:", address(asc));
    }
}
