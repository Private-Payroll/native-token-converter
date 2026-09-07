// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sampleContractAddress } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import { Contract, ledger } from '../contracts/managed/contract/index.js';
import { COMPACTC_VERSION } from '../src/toolchain.js';

interface Argument {
  readonly name: string;
  readonly type: { readonly 'type-name': string; readonly length?: number; readonly maxval?: string };
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
    join(import.meta.dirname, '..', 'contracts', 'managed', 'compiler', 'contract-info.json'),
    'utf8',
  ).replace(/"maxval":\s*(\d+)/g, '"maxval": "$1"'),
) as ContractInfo;

const circuit = (name: string): CircuitInfo => {
  const found = info.circuits.find((each) => each.name === name);
  if (found === undefined) {
    throw new Error(`the contract no longer offers a circuit called ${name}`);
  }
  return found;
};

const shapeOf = (each: CircuitInfo): Array<[string, string]> =>
  each.arguments.map((argument) => [argument.name, argument.type['type-name']]);

describe('what the deployed contract offers', () => {
  it('is two circuits and no others', () => {
    expect(info.circuits.map((each) => each.name).sort()).toEqual(['redeem', 'wrap']);
  });

  it('was built by the pinned compiler', () => {
    expect(info['compiler-version']).toBe(COMPACTC_VERSION);
    expect(info['language-version']).toBe('0.26.0');
    expect(info['runtime-version']).toBe('0.19.0');
  });
});

describe('wrap', () => {
  it('takes one backing colour, one amount, a recipient and a nonce', () => {
    expect(shapeOf(circuit('wrap'))).toEqual([
      ['backing', 'Bytes'],
      ['amount', 'Uint'],
      ['to', 'Struct'],
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
  it('takes one backing colour, the coin, and where to pay', () => {
    expect(shapeOf(circuit('redeem'))).toEqual([
      ['backing', 'Bytes'],
      ['coin', 'Struct'],
      ['to', 'Struct'],
    ]);
  });

  it('takes those three arguments and no fourth', () => {
    // What is burned and what is paid out being one and the same value is
    // checked by running the circuit, in test/converter.test.ts. This only
    // holds the door shut on an amount argument appearing for it to disagree
    // with.
    expect(circuit('redeem').arguments).toHaveLength(3);
  });
});

describe('what construction settles for good', () => {
  const construct = async (name: string, symbol: string) => {
    const built = await new Contract({}).initialState(
      {
        initialZswapLocalState: { coinPublicKey: sampleContractAddress() },
        initialPrivateState: {},
      } as never,
      name,
      symbol,
    );
    return ledger(built.currentContractState.data);
  };

  it('writes the metadata once and marks it written', async () => {
    const state = await construct('Wrapped', 'w');
    expect(state._isInitialized).toBe(true);
    expect(state._name).toBe('Wrapped');
    expect(state._symbol).toBe('w');
  });

  it('fixes decimals at 0, because this contract applies no scaling to anything it wraps', async () => {
    const state = await construct('Wrapped', 'w');
    expect(state._decimals).toBe(0n);
  });

  it('leaves nothing else in public state', async () => {
    const state = await construct('Wrapped', 'w');
    expect(Object.keys(state).sort()).toEqual(['_decimals', '_isInitialized', '_name', '_symbol']);
  });
});
