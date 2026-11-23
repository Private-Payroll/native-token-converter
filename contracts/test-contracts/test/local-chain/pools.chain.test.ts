// SPDX-License-Identifier: Apache-2.0

/**
 * One converter holding many pools, on a real chain. Each test has a test
 * minter mint public tokens of colours nobody has used before to the genesis
 * wallet, wraps them into pools of their own, and reads each pool's backing
 * back from the converter's public balance on the ledger, so no test relies
 * on what another left behind. Every transaction's modelled cost is printed
 * with its share of a block under the chain's own limits, which is what
 * bounds how many conversions fit in one block.
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { encodeUserAddress } from '@midnight-ntwrk/compact-runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import { keyedBuild } from '@native-token-converter/toolchain/keyed-builds';
import {
  call,
  compiledContract,
  contractProviders,
  deploy,
  importCompiledModule,
  type Deployed,
} from '@native-token-converter/local-chain/contracts';
import { OWNERLESS } from '../../../../packages/library/src/released-converter.js';
import { shieldedCoinInfo } from '@native-token-converter/local-chain/wallet';
import { converterOnChain, hex } from '../../../converter/test/local-chain/converter-on-chain.js';

type MinterModule = typeof import('../../managed-keys/PublicTokenMinter/contract/index.js');
type Minter = import('../../managed-keys/PublicTokenMinter/contract/index.js').Contract<undefined>;

const MINTER_BUILD = keyedBuild(join(import.meta.dirname, '..', '..'), 'PublicTokenMinter');

/**
 * Which of the chain's genesis wallets pays. Every chain test file takes its
 * own, so no two spend the same coins.
 */
const GENESIS_WALLET = 1;

/** How many pools a test that needs many gives the converter. */
const POOLS = 6;
/** How much of each colour is minted, and how much of it is wrapped. */
const MINTED = 1_000n;
const WRAPPED = 100n;

const on = converterOnChain(GENESIS_WALLET);
let minter: Deployed<Minter>;

beforeAll(async () => {
  const module = await importCompiledModule<MinterModule>(MINTER_BUILD);
  minter = await deploy(
    contractProviders(on.wallet, on.chain.configuration, MINTER_BUILD),
    compiledContract<Minter>('PublicTokenMinter', module.Contract, MINTER_BUILD),
    OWNERLESS,
  );
  on.measurements.push(minter.measurement);
});

/**
 * Mints MINTED of `count` colours nobody has minted before to the wallet, and
 * waits until the wallet holds them. Returns the colours, in the order minted.
 */
async function mintColours(count: number): Promise<Uint8Array[]> {
  const colours: Uint8Array[] = [];
  for (let each = 0; each < count; each += 1) {
    const minted = await on.measured(
      call(minter, 'mint', [
        randomBytes(32),
        MINTED,
        { bytes: encodeUserAddress(on.wallet.unshieldedAddress) },
      ]),
      `mint ${String(each + 1)}`,
    );
    colours.push(minted.result);
  }
  await on.wallet.waitFor(`${String(count)} public colours of ${String(MINTED)} each`, (held) =>
    colours.every((colour) => held.unshielded[hex(colour)] === MINTED),
  );
  return colours;
}

describe('one converter holding many pools on a local chain', () => {
  it('mints public tokens of several colours to the wallet', async () => {
    const backings = await mintColours(POOLS);
    expect(new Set(backings.map(hex)).size).toBe(POOLS);
  });

  it('backs each pool by exactly what was wrapped into it, and by nothing else', async () => {
    const backings = await mintColours(POOLS);
    for (const [pool, backing] of backings.entries()) {
      await on.wrap(backing, WRAPPED, `wrap ${String(pool + 1)}`);
      const held = await on.pools();
      for (const wrapped of backings.slice(0, pool + 1)) {
        expect(held[hex(wrapped)]).toBe(WRAPPED);
      }
      for (const notYet of backings.slice(pool + 1)) {
        expect(held[hex(notYet)]).toBeUndefined();
      }
    }
  });

  it('a second wrap into the first pool adds to that pool alone', async () => {
    const [first, second] = (await mintColours(2)) as [Uint8Array, Uint8Array];
    await on.wrap(first, WRAPPED, 'wrap 1');
    await on.wrap(second, WRAPPED, 'wrap 2');
    await on.wrap(first, WRAPPED, 'wrap 1 again');
    const held = await on.pools();
    expect(held[hex(first)]).toBe(2n * WRAPPED);
    expect(held[hex(second)]).toBe(WRAPPED);
  });

  it('writes the same bytes for a wrap whichever pool it goes into, however many pools there are', async () => {
    const backings = await mintColours(POOLS);
    const written: bigint[] = [];
    for (const [pool, backing] of [...backings, backings[0] as Uint8Array].entries()) {
      const wrapped = await on.wrap(backing, WRAPPED, `wrap ${String(pool + 1)}`);
      written.push(wrapped.measurement.cost.bytesWritten);
    }
    expect(written.length).toBe(POOLS + 1);
    expect(new Set(written).size).toBe(1);
  });
});

describe('a redeem from one of many pools on a local chain', () => {
  it('pays the wallet out of the last pool alone', async () => {
    const [other, last] = (await mintColours(2)) as [Uint8Array, Uint8Array];
    await on.wrap(other, WRAPPED, 'wrap 1');
    const wrapped = await on.wrap(last, WRAPPED, 'wrap 2');
    const coin = await on.walletCoin(wrapped.result.nonce);
    const holdings = await on.wallet.holdings();
    expect(coin.value).toBe(WRAPPED);
    await on.measured(
      call(on.converter, 'redeem', [last, shieldedCoinInfo(coin), on.toUser()]),
      'redeem 2',
    );
    const held = await on.pools();
    expect(held[hex(last)] ?? 0n).toBe(0n);
    expect(held[hex(other)]).toBe(WRAPPED);
    const paidTo = (holdings.unshielded[hex(last)] ?? 0n) + coin.value;
    await on.wallet.waitFor(
      `${String(paidTo)} of colour ${hex(last)}, the coin's worth paid back to the wallet`,
      (each) => each.unshielded[hex(last)] === paidTo,
    );
  });
});
