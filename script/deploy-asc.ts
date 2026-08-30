import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

const CC_RPC = process.env.CREDITCOIN_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network';
const CC_PK = process.env.CREDITCOIN_WALLET_PRIVATE_KEY!;
const EVM_V1_DECODER_ADDR = '912F3e988d0D8c4b6BD4671bE5D74664A4D24a65';

async function main() {
  const provider = new ethers.JsonRpcProvider(CC_RPC);
  const wallet = new ethers.Wallet(CC_PK, provider);

  const artifact = JSON.parse(
    readFileSync(join(__dirname, '../contracts/out/AttestationReceiver.sol/AttestationReceiver.json'), 'utf8')
  );

  let bytecode: string = artifact.bytecode.object;
  if (!bytecode.startsWith('0x')) bytecode = '0x' + bytecode;

  const placeholders = bytecode.match(/__\$[0-9a-f]+\$__/g);
  if (placeholders) {
    console.log(`Found ${placeholders.length} library placeholders, linking...`);
    bytecode = bytecode.replace(/__\$[0-9a-f]+\$__/g, EVM_V1_DECODER_ADDR);
  }

  console.log('Deploying AttestationReceiver...');
  const factory = new ethers.ContractFactory(artifact.abi, bytecode, wallet);
  const asc = await factory.deploy();
  await asc.waitForDeployment();
  const addr = await asc.getAddress();
  console.log(`AttestationReceiver deployed at: ${addr}`);
}

main().catch(console.error);
