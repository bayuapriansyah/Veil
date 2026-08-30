pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

template ZKReceipt() {
    signal input resultData;
    signal input salt;
    signal input orderId;
    signal input provider;
    signal input serviceId;

    signal output zkProofHash;

    component hash = Poseidon(2);
    hash.inputs[0] <== resultData;
    hash.inputs[1] <== salt;
    zkProofHash <== hash.out;
}

component main {public [orderId, provider, serviceId]} = ZKReceipt();
