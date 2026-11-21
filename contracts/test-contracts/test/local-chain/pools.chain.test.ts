// SPDX-License-Identifier: Apache-2.0

/**
 * One converter holding many pools, on a real chain. Public tokens of several
 * colours are minted to the genesis wallet by a test minter, each is wrapped
 * into its own pool, and each pool's backing is read back from the converter's
 * public balance on the ledger after every wrap and redeem. Every transaction's
 * modelled cost is printed with its share of a block under the chain's own
 * limits, which is what bounds how many conversions fit in one block.
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { encodeCoinPublicKey, encodeUserAddress } from '@midnight-ntwrk/compact-runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keyedBuild } from '@native-token-converter/toolchain/keyed-builds';
import {
  call,
  compiledContract,
  contractBalances,
  contractProviders,
  deploy,
  importCompiledModule,
  measurementLine,
  type Deployed,
  type Measurement,
} from '@native-token-converter/local-chain/contracts';
import type { LocalChain } from '@native-token-converter/local-chain/services';
import { chainSession } from '@native-token-converter/local-chain/session';
import {
  NIGHT,
  shieldedCoinInfo,
  type LocalWallet,
} from '@native-token-converter/local-chain/wallet';
import { wrappedColour } from '../../../../packages/library/src/wrapped-colour.js';

type ConverterModule =
  typeof import('../../../converter/managed-keys/NativeTokenConverter/contract/index.js');
type Converter =
  import('../../../converter/managed-keys/NativeTokenConverter/contract/index.js').Contract<undefined>;
type MinterModule = typeof import('../../managed-keys/PublicTokenMinter/contract/index.js');
type Minter = import('../../managed-keys/PublicTokenMinter/contract/index.js').Contract<undefined>;

const WORKSPACE = join(import.meta.dirname, '..', '..');
const CONVERTER_BUILD = keyedBuild(join(WORKSPACE, '..', 'converter'), 'NativeTokenConverter');
const MINTER_BUILD = keyedBuild(WORKSPACE, 'PublicTokenMinter');

/** How many pools the converter is given. */
const POOLS = 6;
/** How much of each colour is minted, and how much of it is wrapped. */
const MINTED = 1_000n;
const WRAPPED = 100n;

let chain: LocalChain;
let wallet: LocalWallet;
let converter: Deployed<Converter>;
let minter: Deployed<Minter>;
const backings: Uint8Array[] = [];
const measurements: Measurement[] = [];
/** The chain and wallet beforeAll starts, stopped by afterAll however far the start got. */
const session = chainSession();

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const separator = (pool: number): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes[31] = pool + 1;
  return bytes;
};

/** The converter's public balance of each backing colour: its pools, as the ledger holds them. */
async function pools(): Promise<Readonly<Record<string, bigint>>> {
  return contractBalances(converter.through, converter.address);
}

beforeAll(async () => {
  // Its own genesis wallet, so this file never spends the coins another file is using.
  ({ chain, wallet } = await session.start(1));
  const converterModule = await importCompiledModule<ConverterModule>(CONVERTER_BUILD);
  const minterModule = await importCompiledModule<MinterModule>(MINTER_BUILD);
  converter = await deploy(
    contractProviders(wallet, chain.configuration, CONVERTER_BUILD),
    compiledContract<Converter>('NativeTokenConverter', converterModule.Contract, CONVERTER_BUILD),
    ['Wrapped', 'w'],
  );
  minter = await deploy(
    contractProviders(wallet, chain.configuration, MINTER_BUILD),
    compiledContract<Minter>('PublicTokenMinter', minterModule.Contract, MINTER_BUILD),
    [],
  );
  measurements.push(converter.measurement, minter.measurement);
});

afterAll(async () => {
  console.log(
    `\nmeasured on ${process.platform} ${process.arch}\n${measurements.map(measurementLine).join('\n')}\n`,
  );
  await session.stop();
});

describe('one converter holding many pools on a local chain', () => {
  it('mints public tokens of several colours to the wallet', async () => {
    for (let pool = 0; pool < POOLS; pool += 1) {
      const minted = await call(minter, 'mint', [
        separator(pool),
        MINTED,
        { bytes: encodeUserAddress(wallet.unshieldedAddress) },
      ]);
      measurements.push({ ...minted.measurement, label: `mint ${String(pool + 1)}` });
      backings.push(minted.result);
    }
    const holdings = await wallet.waitFor(
      `${String(POOLS)} public colours of ${String(MINTED)} each`,
      (held) => backings.every((colour) => held.unshielded[hex(colour)] === MINTED),
    );
    expect(new Set(backings.map(hex)).size).toBe(POOLS);
    expect(backings.every((colour) => holdings.unshielded[hex(colour)] === MINTED)).toBe(true);
  });

  it('backs each pool by exactly what was wrapped into it, and by nothing else', async () => {
    for (const [pool, backing] of backings.entries()) {
      const wrapped = await call(converter, 'wrap', [
        backing,
        WRAPPED,
        { bytes: encodeCoinPublicKey(wallet.coinPublicKey) },
        randomBytes(32),
      ]);
      measurements.push({ ...wrapped.measurement, label: `wrap ${String(pool + 1)}` });
      expect(hex(wrapped.result.color)).toBe(hex(wrappedColour(backing, converter.address)));
      const held = await pools();
      expect(Object.keys(held).filter((colour) => colour !== NIGHT).length).toBe(pool + 1);
      for (const earlier of backings.slice(0, pool + 1)) {
        expect(held[hex(earlier)]).toBe(WRAPPED);
      }
    }
  });

  it('a second wrap into the first pool adds to that pool alone', async () => {
    const wrapped = await call(converter, 'wrap', [
      backings[0] as Uint8Array,
      WRAPPED,
      { bytes: encodeCoinPublicKey(wallet.coinPublicKey) },
      randomBytes(32),
    ]);
    measurements.push({ ...wrapped.measurement, label: `wrap 1 again` });
    const held = await pools();
    expect(held[hex(backings[0] as Uint8Array)]).toBe(2n * WRAPPED);
    for (const other of backings.slice(1)) {
      expect(held[hex(other)]).toBe(WRAPPED);
    }
  });

  it('writes the same bytes for a wrap whichever pool it goes into, however many pools there are', () => {
    const written = measurements
      .filter((each) => each.label.startsWith('wrap'))
      .map((each) => each.cost.bytesWritten);
    expect(written.length).toBe(POOLS + 1);
    expect(new Set(written).size).toBe(1);
  });

  it('a redeem from the last pool pays out of that pool alone', async () => {
    const last = backings[POOLS - 1] as Uint8Array;
    const colour = hex(wrappedColour(last, converter.address));
    const holdings = await wallet.waitFor(`a coin of colour ${colour}`, (held) =>
      held.shieldedCoins.some((each) => each.colour === colour),
    );
    const coin = holdings.shieldedCoins.find((each) => each.colour === colour);
    if (coin === undefined) {
      throw new Error(`the wallet holds no coin of colour ${colour}`);
    }
    const redeemed = await call(converter, 'redeem', [
      last,
      shieldedCoinInfo(coin),
      { bytes: encodeUserAddress(wallet.unshieldedAddress) },
    ]);
    measurements.push({ ...redeemed.measurement, label: `redeem ${String(POOLS)}` });
    const held = await pools();
    expect(held[hex(last)] ?? 0n).toBe(0n);
    expect(held[hex(backings[0] as Uint8Array)]).toBe(2n * WRAPPED);
  });
});
