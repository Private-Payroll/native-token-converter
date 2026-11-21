// SPDX-License-Identifier: Apache-2.0

/**
 * What one chain test file starts and stops: a local chain and a wallet
 * funded at its genesis. Each file starts its own, so files never share
 * coins or contracts, and stops it however far the start got.
 */

import { startLocalChain, type LocalChain } from './services.js';
import { genesisWallet, type LocalWallet } from './wallet.js';

/**
 * Runs each stop, the last added first, and tries every one even when an
 * earlier one throws, so a wallet that fails to stop cannot leave the chain
 * running. Throws once at the end, naming every failure.
 */
export async function stopAll(stops: readonly (() => unknown)[]): Promise<void> {
  const failures: unknown[] = [];
  for (const stop of [...stops].reverse()) {
    try {
      await stop();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'could not stop everything the tests started');
  }
}

/** A started chain and its funded wallet, and how to stop them. */
export interface ChainSession {
  readonly chain: LocalChain;
  readonly wallet: LocalWallet;
}

/**
 * The chain and wallet a test file's `beforeAll` starts, and the `stop` its
 * `afterAll` calls. `stop` is safe to call when `start` failed half way or
 * never ran.
 */
export function chainSession(): {
  start(genesisSeed?: number): Promise<ChainSession>;
  stop(): Promise<void>;
} {
  const stops: (() => unknown)[] = [];
  return {
    async start(genesisSeed = 0) {
      const chain = await startLocalChain();
      stops.push(() => {
        chain.stop();
      });
      const wallet = await genesisWallet(chain.configuration, genesisSeed);
      stops.push(() => wallet.stop());
      return { chain, wallet };
    },
    stop: () => stopAll(stops),
  };
}
