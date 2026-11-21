// SPDX-License-Identifier: Apache-2.0

/**
 * The converter on a real chain: deployed from the genesis wallet, NIGHT
 * wrapped into a shielded coin, the coin found by the wallet scanning for it,
 * and redeemed back to NIGHT. Every transaction is proved by the pinned proof
 * server and finalized by the pinned node, and its size, modelled cost, fee
 * and timings are printed. Run with `npm run test:local-chain`; the services
 * are started with Docker unless the LOCAL_CHAIN_* variables name running ones.
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { encodeCoinPublicKey, encodeUserAddress } from '@midnight-ntwrk/compact-runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keyedBuild } from '@native-token-converter/toolchain/keyed-builds';
import {
  call,
  compiledContract,
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
  type Holdings,
  type LocalWallet,
  type ShieldedCoin,
} from '@native-token-converter/local-chain/wallet';
import { wrappedColour } from '../../../../packages/library/src/wrapped-colour.js';

type ConverterModule = typeof import('../../managed-keys/NativeTokenConverter/contract/index.js');
/** The converter declares no private state. */
type Converter =
  import('../../managed-keys/NativeTokenConverter/contract/index.js').Contract<undefined>;

const BUILD = keyedBuild(join(import.meta.dirname, '..', '..'), 'NativeTokenConverter');

/** How much NIGHT is wrapped and redeemed, in its smallest unit. */
const AMOUNT = 1_000_000n;

let chain: LocalChain;
let wallet: LocalWallet;
let converter: Deployed<Converter>;
const measurements: Measurement[] = [];
/** The chain and wallet beforeAll starts, stopped by afterAll however far the start got. */
const session = chainSession();

const night = (holdings: Holdings): bigint => holdings.unshielded[NIGHT] ?? 0n;
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

beforeAll(async () => {
  ({ chain, wallet } = await session.start());
  const module = await importCompiledModule<ConverterModule>(BUILD);
  const through = contractProviders(wallet, chain.configuration, BUILD);
  converter = await deploy(
    through,
    compiledContract<Converter>('NativeTokenConverter', module.Contract, BUILD),
    ['Wrapped NIGHT', 'wNIGHT'],
  );
  measurements.push(converter.measurement);
});

afterAll(async () => {
  console.log(
    `\nmeasured on ${process.platform} ${process.arch}\n${measurements.map(measurementLine).join('\n')}\n`,
  );
  await session.stop();
});

describe('the converter on a local chain', () => {
  let coin: ShieldedCoin;
  let nightBeforeWrap: bigint;

  it('wraps NIGHT into a shielded coin of its pool colour, which the wallet finds', async () => {
    nightBeforeWrap = night(await wallet.holdings());
    const backing = Buffer.from(NIGHT, 'hex');
    const colour = hex(wrappedColour(backing, converter.address));
    const wrapped = await call(converter, 'wrap', [
      backing,
      AMOUNT,
      { bytes: encodeCoinPublicKey(wallet.coinPublicKey) },
      randomBytes(32),
    ]);
    measurements.push(wrapped.measurement);
    expect(hex(wrapped.result.color)).toBe(colour);

    const holdings = await wallet.waitFor(`a shielded coin of colour ${colour}`, (held) =>
      held.shieldedCoins.some((each) => each.colour === colour && each.value === AMOUNT),
    );
    const found = holdings.shieldedCoins.find((each) => each.colour === colour);
    expect(found?.value).toBe(AMOUNT);
    expect(night(holdings)).toBe(nightBeforeWrap - AMOUNT);
    if (found !== undefined) {
      coin = found;
    }
  });

  it('redeems that coin back to the wallet, and its NIGHT returns', async () => {
    const redeemed = await call(converter, 'redeem', [
      Buffer.from(NIGHT, 'hex'),
      shieldedCoinInfo(coin),
      { bytes: encodeUserAddress(wallet.unshieldedAddress) },
    ]);
    measurements.push(redeemed.measurement);

    const holdings = await wallet.waitFor(
      `${String(nightBeforeWrap)} NIGHT again`,
      (held) => night(held) === nightBeforeWrap,
    );
    expect(holdings.shieldedCoins.some((each) => each.colour === coin.colour)).toBe(false);
  });
});
