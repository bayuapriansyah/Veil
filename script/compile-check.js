#!/usr/bin/env node
/**
 * Compile-check for VEIL contracts using solc-js via Standard JSON.
 * Resolves @openzeppelin and @gluwa imports from node_modules via remappings.
 *
 * Usage: node script/compile-check.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const contractsRoot = path.join(root, 'contracts');

// Resolve the solc module: prefer a local install, else search the npx cache.
function findSolc() {
  try {
    return require('solc');
  } catch {
    /* fall through to npx cache scan */
  }
  const npxRoot = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  if (!fs.existsSync(npxRoot)) throw new Error('solc not found and no npx cache');
  for (const dir of fs.readdirSync(npxRoot)) {
    const candidate = path.join(npxRoot, dir, 'node_modules', 'solc', 'index.js');
    if (fs.existsSync(candidate)) return require(candidate);
    const legacy = path.join(npxRoot, dir, 'node_modules', 'solc');
    if (fs.existsSync(path.join(legacy, 'package.json'))) return require(legacy);
  }
  throw new Error('solc not found in npx cache');
}

const solc = findSolc();

function sourcesFromDir(dir, prefix = '') {
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(out, sourcesFromDir(p, path.join(prefix, entry.name)));
    } else if (entry.name.endsWith('.sol')) {
      out[path.join(prefix, entry.name).replace(/\\/g, '/')] = {
        content: fs.readFileSync(p, 'utf8'),
      };
    }
  }
  return out;
}

const input = {
  language: 'Solidity',
  sources: {
    ...sourcesFromDir(path.join(contractsRoot, 'src')),
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris',
    remappings: [
      '@openzeppelin/=node_modules/@openzeppelin/',
      '@gluwa/usc-contracts/=node_modules/@gluwa/usc-contracts/',
    ],
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'],
      },
    },
  },
};

console.log(`Using ${solc.version()}`);

const output = solc.compile(JSON.stringify(input), {
  import: (importPath) => {
    // Resolve remapped imports against node_modules relative to project root.
    for (const remap of ['@openzeppelin/', '@gluwa/usc-contracts/']) {
      if (importPath.startsWith(remap)) {
        const resolved = path.join(root, 'node_modules', importPath.slice(remap.length));
        if (fs.existsSync(resolved)) return { contents: fs.readFileSync(resolved, 'utf8') };
      }
    }
    const direct = path.join(root, importPath);
    if (fs.existsSync(direct)) return { contents: fs.readFileSync(direct, 'utf8') };
    return { error: `File not found: ${importPath}` };
  },
});

const result = JSON.parse(output);
if (result.errors) {
  let failed = false;
  for (const e of result.errors) {
    if (e.severity === 'error') {
      failed = true;
      console.error(`ERROR ${e.formattedMessage ?? e.message}`);
    }
  }
  if (failed) process.exit(1);
}

const contracts = [];
for (const [file, items] of Object.entries(result.contracts)) {
  for (const name of Object.keys(items)) {
    contracts.push(`${file}:${name}`);
  }
}
console.log(`Compiled OK: ${contracts.length} contracts`);
for (const c of contracts) console.log('  ' + c);