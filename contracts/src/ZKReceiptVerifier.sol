// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.23;

contract ZKReceiptVerifier {
    uint256 constant r = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 constant q = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    uint256 constant alphax = 1224606263804357697629470081723462995931925571097299951838057649657609513732;
    uint256 constant alphay = 15271504824528913359620547961737982047271686370899885523703652287619031237321;
    uint256 constant betax1 = 262078656610250687918783578149809246174217047268261884110459797836911306192;
    uint256 constant betax2 = 969687699915055407689809642412091721472871024195127426972936045777126300293;
    uint256 constant betay1 = 7216627453218687213834507319800668580455656930864822519778780813147449848445;
    uint256 constant betay2 = 10707981830545105581214604054698736593547982848636095383774772078936152085203;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 18823965021667107072564388569479317292450758806118955947727823161023755757218;
    uint256 constant deltax2 = 18974505211246769118232400746760332947894417662998185419009989733483828529760;
    uint256 constant deltay1 = 19119062804219730531760422745405283225378717652779345585202376622882168246279;
    uint256 constant deltay2 = 2949782594821121831574025011841836120104361661358066253494276098957144146252;

    uint256 constant IC0x = 5202525791708728540209175394012857558449910804471378725477149690356013539342;
    uint256 constant IC0y = 20700191014533884313908355296000994704402809453817350706978667866514419539416;
    uint256 constant IC1x = 14057495524965306247075346241188040074199907709107216560286063996037974313215;
    uint256 constant IC1y = 15972541664034806428049632033891694117873772453020061128453592819792941445260;
    uint256 constant IC2x = 14828862518691664382767127672598131467855076865125694419953926483615701079355;
    uint256 constant IC2y = 13029476040214641468547732505227943279695462773543356839081413625037743067062;
    uint256 constant IC3x = 18327379016257270692920031869165308313237756549376744863757404163939725104235;
    uint256 constant IC3y = 10938072684893802667677204062712880236648243558226849351932826572924598915622;
    uint256 constant IC4x = 17624857030711621762526452195396734117165968063832636348505846555610198241513;
    uint256 constant IC4y = 5583048355376411955188189908596114657121100162297751917703716955831716512992;

    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;
    uint16 constant pLastMem = 896;

    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[4] calldata _pubSignals
    ) public view returns (bool) {
        require(_pubSignals[0] < r, "ZKReceiptVerifier: public input exceeds field");
        require(_pubSignals[1] < r, "ZKReceiptVerifier: public input exceeds field");
        require(_pubSignals[2] < r, "ZKReceiptVerifier: public input exceeds field");
        require(_pubSignals[3] < r, "ZKReceiptVerifier: public input exceeds field");

        assembly {
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)
                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)
                if iszero(success) { revert(0, 0) }
                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))
                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)
                if iszero(success) { revert(0, 0) }
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            let _pVk := add(pMem, pVk)
            mstore(_pVk, IC0x)
            mstore(add(_pVk, 32), IC0y)

            g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(_pubSignals, 0)))
            g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(_pubSignals, 32)))
            g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(_pubSignals, 64)))
            g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(_pubSignals, 96)))

            let _pPairing := add(pMem, pPairing)

            mstore(_pPairing, calldataload(_pA))
            mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(_pA, 32))), q))
            mstore(add(_pPairing, 64), calldataload(_pB))
            mstore(add(_pPairing, 96), calldataload(add(_pB, 32)))
            mstore(add(_pPairing, 128), calldataload(add(_pB, 64)))
            mstore(add(_pPairing, 160), calldataload(add(_pB, 96)))
            mstore(add(_pPairing, 192), alphax)
            mstore(add(_pPairing, 224), alphay)
            mstore(add(_pPairing, 256), betax1)
            mstore(add(_pPairing, 288), betax2)
            mstore(add(_pPairing, 320), betay1)
            mstore(add(_pPairing, 352), betay2)
            mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
            mstore(add(_pPairing, 416), mload(add(_pVk, 32)))
            mstore(add(_pPairing, 448), gammax1)
            mstore(add(_pPairing, 480), gammax2)
            mstore(add(_pPairing, 512), gammay1)
            mstore(add(_pPairing, 544), gammay2)
            mstore(add(_pPairing, 576), calldataload(_pC))
            mstore(add(_pPairing, 608), calldataload(add(_pC, 32)))
            mstore(add(_pPairing, 640), deltax1)
            mstore(add(_pPairing, 672), deltax2)
            mstore(add(_pPairing, 704), deltay1)
            mstore(add(_pPairing, 736), deltay2)

            let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)
            if iszero(success) { revert(0, 0) }
            mstore(0, mload(_pPairing))
            return(0, 0x20)
        }
    }

    function getVerificationKeyHash() external pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            alphax, alphay, betax1, betax2, betay1, betay2,
            gammax1, gammax2, gammay1, gammay2,
            deltax1, deltax2, deltay1, deltay2
        ));
    }
}
