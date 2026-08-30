#!/usr/bin/env node
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

process.on('message', async (msg) => {
  try {
    const snarkjs = require('snarkjs');
    const { keccak256, toUtf8Bytes } = require('ethers');

    const circuitsDir = join(process.cwd(), 'circuits');
    const wasm = readFileSync(join(circuitsDir, 'zk-receipt.wasm'));
    const zkey = readFileSync(join(circuitsDir, 'zk-receipt_final.zkey'));

    const input = {
      resultData: String(msg.resultData),
      salt: String(msg.salt),
      orderId: String(msg.orderId),
      provider: String(BigInt(msg.providerAddress)),
      serviceId: keccak256(toUtf8Bytes(msg.serviceId)),
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
    process.send({ ok: true, proof, publicSignals });
  } catch (e) {
    process.send({ ok: false, error: e.message ?? String(e) });
  } finally {
    process.exit(0);
  }
});
