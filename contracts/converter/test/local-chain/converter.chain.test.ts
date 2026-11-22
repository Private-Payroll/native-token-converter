// SPDX-License-Identifier: Apache-2.0

/**
 * The converter on a real chain: deployed from a genesis wallet, NIGHT
 * wrapped into a shielded coin the wallet finds by scanning for it, and a coin
 * redeemed back to NIGHT, with the pool read from the converter's public
 * balance on the ledger before and after each call. Every transaction is
 * proved by the pinned proof server and finalized by the pinned node, and its
 * size, modelled cost, fee and timings are printed. Run with
 * `npm run test:local-chain`; the services are started with Docker unless the
 * LOCAL_CHAIN_* variables name running ones.
 */

import { describe, expect, it } from 'vitest';
import { call } from '@native-token-converter/local-chain/contracts';
import { NIGHT, shieldedCoinInfo, type Holdings } from '@native-token-converter/local-chain/wallet';
import { converterOnChain } from './converter-on-chain.js';

/**
 * Which of the chain's genesis wallets pays. Every chain test file takes its
 * own, so no two spend the same coins.
 */
const GENESIS_WALLET = 0;

/** How much NIGHT is wrapped and redeemed, in its smallest unit. */
const AMOUNT = 1_000_000n;
const BACKING = Buffer.from(NIGHT, 'hex');

const on = converterOnChain(GENESIS_WALLET);

const night = (holdings: Holdings): bigint => holdings.unshielded[NIGHT] ?? 0n;

/** How many coins of the NIGHT pool's colour the wallet holds, synced to the chain's tip. */
async function coinsOfPool(): Promise<number> {
  const colour = on.colourOf(BACKING);
  const held = await on.wallet.holdings();
  return held.shieldedCoins.filter((each) => each.colour === colour).length;
}

describe('the converter on a local chain', () => {
  it('takes the NIGHT it wraps into its pool and mints a coin of the pool colour, which the wallet finds', async () => {
    const nightBefore = night(await on.wallet.holdings());
    const poolBefore = await on.pool(BACKING);

    const coin = await on.wrapToWallet(BACKING, AMOUNT);

    expect(coin.value).toBe(AMOUNT);
    expect(await on.pool(BACKING)).toBe(poolBefore + AMOUNT);
    await on.wallet.waitFor(
      `${String(nightBefore - AMOUNT)} NIGHT`,
      (held) => night(held) === nightBefore - AMOUNT,
    );
  });

  it('redeems a coin of the pool colour for the NIGHT it is worth, paid to the wallet', async () => {
    const nightBefore = night(await on.wallet.holdings());
    const coinsBefore = await coinsOfPool();
    const coin = await on.wrapToWallet(BACKING, AMOUNT);
    const poolBefore = await on.pool(BACKING);

    await on.measured(call(on.converter, 'redeem', [BACKING, shieldedCoinInfo(coin), on.toUser()]));

    expect(await on.pool(BACKING)).toBe(poolBefore - AMOUNT);
    await on.wallet.waitFor(
      `${String(nightBefore)} NIGHT again`,
      (held) => night(held) === nightBefore,
    );
    // The wallet ends with as many coins of the pool colour as it held before
    // the wrap: the redeem paid none back to it.
    expect(await coinsOfPool()).toBe(coinsBefore);
  });
});
