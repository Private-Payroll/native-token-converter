// SPDX-License-Identifier: Apache-2.0

/**
 * A scanning wallet on a local development chain: one funded at the chain's
 * genesis, or a fresh empty one to receive.
 *
 * The wallet itself, its seeds and the genesis seeds the development chain
 * funds are testkit-js's, used as they are; this adds only reading what a
 * synced wallet holds, by colour, and waiting until it holds something. A
 * wallet that never shows what it is waited for is refused, naming what was
 * expected and what it held instead.
 */

import {
  LocalTestEnvironment,
  logger,
  MidnightWalletProvider,
  syncWallet,
  type EnvironmentConfiguration,
} from '@midnight-ntwrk/testkit-js';
import { encodeShieldedCoinInfo } from '@midnight-ntwrk/compact-runtime';

/*
 * testkit-js logs every step of every sync at info level, and one call logs
 * hundreds of lines. Warnings and errors are kept; set LOCAL_CHAIN_LOG_LEVEL
 * to info or debug to see the rest.
 */
logger.level = process.env['LOCAL_CHAIN_LOG_LEVEL'] ?? 'warn';

/** The raw colour of NIGHT, the chain's native unshielded token: thirty-two zero bytes. */
export const NIGHT = '0'.repeat(64);

/** One shielded coin a wallet holds, as the wallet reports it. */
export interface ShieldedCoin {
  /** The coin's colour, as 64 hex characters. */
  readonly colour: string;
  readonly value: bigint;
  /** The coin's nonce, as 64 hex characters. */
  readonly nonce: string;
}

/** What a synced wallet holds. */
export interface Holdings {
  /** Every spendable shielded coin, one entry per coin. */
  readonly shieldedCoins: readonly ShieldedCoin[];
  /** Shielded balances by colour. */
  readonly shielded: Readonly<Record<string, bigint>>;
  /** Unshielded balances by colour; NIGHT is under {@link NIGHT}. */
  readonly unshielded: Readonly<Record<string, bigint>>;
  /** The DUST the wallet can pay fees with now. */
  readonly dust: bigint;
}

/** A wallet that is started and synced, and what a contract call needs from it. */
export interface LocalWallet {
  /** The wallet and midnight providers a contract is deployed and called through. */
  readonly provider: MidnightWalletProvider;
  /** The key a shielded coin is minted to, as 64 hex characters. */
  readonly coinPublicKey: string;
  /** The address unshielded tokens are paid to, as 64 hex characters. */
  readonly unshieldedAddress: string;
  /** Syncs to the chain's tip and reports what the wallet holds there. */
  holdings(): Promise<Holdings>;
  /**
   * Syncs until `satisfied` holds of what the wallet holds, and returns that.
   * Refuses after `seconds`, naming `expected` and the last holdings seen.
   */
  waitFor(
    expected: string,
    satisfied: (holdings: Holdings) => boolean,
    seconds?: number,
  ): Promise<Holdings>;
  stop(): Promise<void>;
}

type Synced = Awaited<ReturnType<typeof syncWallet>>;

function holdingsOf(state: Synced): Holdings {
  return {
    shieldedCoins: state.shielded.availableCoins.map(({ coin }) => ({
      colour: coin.type,
      value: coin.value,
      nonce: coin.nonce,
    })),
    shielded: { ...state.shielded.balances },
    unshielded: { ...state.unshielded.balances },
    dust: state.dust.balance(new Date()),
  };
}

/** Holdings written for a person, with bigints as decimal strings. */
export function describeHoldings(holdings: Holdings): string {
  return JSON.stringify(holdings, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

/** The refusal for a wallet that never showed what it was waited for. */
export function neverSeen(expected: string, seconds: number, last: Holdings | undefined): string {
  const held =
    last === undefined ? 'it never finished syncing' : `it held ${describeHoldings(last)}`;
  return (
    `the wallet did not show ${expected} within ${String(seconds)} seconds; ${held}. ` +
    'If the transaction that should have produced it was finalized, check that its output was ' +
    "encrypted to this wallet's key; otherwise give the chain longer."
  );
}

/**
 * A shielded coin in the shape a Compact circuit takes a `ShieldedCoinInfo`
 * argument in.
 */
export function shieldedCoinInfo(coin: ShieldedCoin): {
  readonly nonce: Uint8Array;
  readonly color: Uint8Array;
  readonly value: bigint;
} {
  return encodeShieldedCoinInfo({ type: coin.colour, nonce: coin.nonce, value: coin.value });
}

async function started(provider: MidnightWalletProvider, funded: boolean): Promise<LocalWallet> {
  // A funded wallet is started the way testkit-js starts one, which also
  // registers its NIGHT to generate DUST when it has none, so it can pay fees.
  await provider.start(funded);
  const holdings = async (): Promise<Holdings> => holdingsOf(await syncWallet(provider.wallet));
  return {
    provider,
    coinPublicKey: provider.getCoinPublicKey(),
    unshieldedAddress: provider.unshieldedKeystore.getAddress(),
    holdings,
    async waitFor(expected, satisfied, seconds = 180) {
      const deadline = Date.now() + seconds * 1_000;
      let last: Holdings | undefined;
      while (Date.now() < deadline) {
        last = await holdings();
        if (satisfied(last)) {
          return last;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      throw new Error(neverSeen(expected, seconds, last));
    },
    stop: () => provider.stop(),
  };
}

/**
 * A wallet a development chain funds at genesis, started, synced and able to
 * pay fees. The seed is the `which`-th of the genesis seeds testkit-js names,
 * the first by default; two test files on one chain at once each take their
 * own, so neither spends a coin the other is spending.
 */
export async function genesisWallet(
  configuration: EnvironmentConfiguration,
  which = 0,
): Promise<LocalWallet> {
  const seeds = new LocalTestEnvironment(logger).genesisMintWalletSeed;
  const seed = seeds[which];
  if (seed === undefined) {
    throw new Error(
      `testkit-js names ${String(seeds.length)} genesis seeds for a local chain and there is no seed ${String(which)}; ` +
        'ask for one below that, or check its version against package.json',
    );
  }
  return started(await MidnightWalletProvider.build(logger, configuration, seed), true);
}

/** A wallet from a fresh random seed, holding nothing, to receive with. */
export async function freshWallet(configuration: EnvironmentConfiguration): Promise<LocalWallet> {
  return started(await MidnightWalletProvider.build(logger, configuration), false);
}
