// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sampleContractAddress } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import { Contract, ledger } from '../managed/contract/index.js';
import { COMPACTC_VERSION } from '@native-token-converter/toolchain';

interface Argument {
  readonly name: string;
  readonly type: {
    readonly 'type-name': string;
    readonly length?: number;
    readonly maxval?: string;
    readonly name?: string;
  };
}
interface CircuitInfo {
  readonly name: string;
  readonly arguments: readonly Argument[];
  readonly 'result-type': { readonly 'type-name': string; readonly name?: string };
}
interface ContractInfo {
  readonly 'compiler-version': string;
  readonly 'language-version': string;
  readonly 'runtime-version': string;
  readonly circuits: readonly CircuitInfo[];
}

// Every `maxval` is quoted before parsing. A Compact ceiling of 2^64 - 1 does
// not survive a double: it and 2^64 are the same JavaScript number, so parsing
// this file normally would make an assertion about the mint ceiling unable to
// see the off-by-one it exists to catch.
const info = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', 'managed', 'compiler', 'contract-info.json'),
    'utf8',
  ).replace(/"maxval":\s*(\d+)/g, '"maxval": "$1"'),
) as ContractInfo;

// The runtime the compiled contract is checked against is the one this package
// installs, read from where it is pinned rather than written here a second time.
const manifest = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', '..', '..', 'packages', 'library', 'package.json'),
    'utf8',
  ),
) as { readonly dependencies: Readonly<Record<string, string>> };

// The language version the source asks for, read from its pragma. The pragma
// names one exact version, with no range, so the compiled contract can only
// have been checked against the language this source was written in.
const pragma = /^pragma language_version ([^;]+);$/m.exec(
  readFileSync(join(import.meta.dirname, '..', 'src', 'NativeTokenConverter.compact'), 'utf8'),
)?.[1];

const circuit = (name: string): CircuitInfo => {
  const found = info.circuits.find((each) => each.name === name);
  if (found === undefined) {
    throw new Error(`the contract no longer offers a circuit called ${name}`);
  }
  return found;
};

const shapeOf = (each: CircuitInfo): Array<[string, string]> =>
  each.arguments.map((argument) => [
    argument.name,
    argument.type.name ?? argument.type['type-name'],
  ]);

describe('what the deployed contract offers', () => {
  it('is two circuits and no others', () => {
    expect(info.circuits.map((each) => each.name).sort()).toEqual(['redeem', 'wrap']);
  });

  // A circuit can spend a coin this contract holds only through the runtime's
  // input builder and the nullifier it claims, whichever path the spend is on.
  // Neither appears anywhere in the compiled circuits, so no path of any of them
  // spends a note this contract keeps, however rarely that path is taken.
  it('has no circuit that spends a shielded coin, on any path', () => {
    const compiled = readFileSync(
      join(import.meta.dirname, '..', 'managed', 'contract', 'index.js'),
      'utf8',
    );
    expect(compiled).not.toMatch(/createZswapInput/);
    expect(compiled).not.toMatch(/Nullifier/);
  });

  it('was built by the pinned compiler', () => {
    expect(info['compiler-version']).toBe(COMPACTC_VERSION);
  });

  it('asks for one exact language version, and was compiled against that one', () => {
    expect(pragma).toMatch(/^\d+\.\d+\.\d+$/);
    expect(info['language-version']).toBe(pragma);
  });

  it('expects the runtime this package depends on, and no other', () => {
    expect(info['runtime-version']).toBe(manifest.dependencies['@midnight-ntwrk/compact-runtime']);
  });
});

describe('wrap', () => {
  it('takes one backing colour, one amount, a key or a contract to mint to, and a nonce', () => {
    expect(shapeOf(circuit('wrap'))).toEqual([
      ['backing', 'Bytes'],
      ['amount', 'Uint'],
      ['to', 'Either'],
      ['nonce', 'Bytes'],
    ]);
  });

  it('caps the amount at the protocol mint ceiling, so an over-ceiling wrap cannot be asked for', () => {
    const amount = circuit('wrap').arguments[1];
    expect(BigInt(amount?.type.maxval ?? '0')).toBe(2n ** 64n - 1n);
  });

  it('hands the minted coin back to the caller', () => {
    expect(circuit('wrap')['result-type'].name).toBe('ShieldedCoinInfo');
  });
});

describe('redeem', () => {
  it('takes one backing colour, the coin, and a contract or a user address to pay', () => {
    expect(shapeOf(circuit('redeem'))).toEqual([
      ['backing', 'Bytes'],
      ['coin', 'ShieldedCoinInfo'],
      ['to', 'Either'],
    ]);
  });
});

describe('construction', () => {
  it('leaves nothing in public state', async () => {
    const built = await new Contract({}).initialState({
      initialZswapLocalState: { coinPublicKey: sampleContractAddress() },
      initialPrivateState: {},
    } as never);
    expect(Object.keys(ledger(built.currentContractState.data))).toEqual([]);
    // A field the contract does not export is still public on the chain, and
    // is not among the names above; the state itself must hold no field at all.
    const held = built.currentContractState.data.state;
    expect(held.type()).toBe('array');
    expect(held.asArray()).toHaveLength(0);
  });
});
