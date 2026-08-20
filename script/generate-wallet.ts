import { Wallet } from 'ethers';
import * as fs from 'fs';

const wallet = Wallet.createRandom();
fs.writeFileSync('.wallet', JSON.stringify({
  address: wallet.address,
  privateKey: wallet.privateKey
}, null, 2));

console.log(`Demo wallet created.`);
console.log(`Address: ${wallet.address}`);
console.log(`Private key saved to .wallet (gitignored).`);
