// SPDX-License-Identifier: Apache-2.0

/**
 * The converter deployed on a local chain, for every chain test that uses it:
 * the chain and a genesis wallet started before a file's tests and stopped
 * after them, the converter deployed from that wallet through the one deploy
 * that refuses anything but the released converter, held by nobody, its
 * authority and its differences from the release read back, the wallet as a mint
 * recipient and as a payee, wraps to the wallet, and the pools read from the
 * converter's public balance on the ledger. Every transaction measured is
 * printed once the file's tests have run.
 */

import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  encodeCoinPublicKey,
  encodeUserAddress,
  sampleSigningKey,
} from '@midnight-ntwrk/compact-runtime';
import {
  createContractMaintenanceTxInterface,
  type Ledger9ContractProviders,
} from '@midnight-ntwrk/midnight-js-contracts';
import { afterAll, beforeAll, expect } from 'vitest';
import { keyedBuild } from '@native-token-converter/toolchain/keyed-builds';
import {
  call,
  compiledContract,
  contractBalances,
  contractProviders,
  deploy,
  deployConverter,
  deployedState,
  importCompiledModule,
  measurementSummary,
  type Called,
  type ContractBuild,
  type Deployed,
  type Measurement,
} from '@native-token-converter/local-chain/contracts';
import type { LocalChain } from '@native-token-converter/local-chain/services';
import { chainSession } from '@native-token-converter/local-chain/session';
import type { LocalWallet, ShieldedCoin } from '@native-token-converter/local-chain/wallet';
import {
  OWNERLESS,
  converterProblems,
} from '../../../../packages/library/src/released-converter.js';
import { wrappedColour } from '../../../../packages/library/src/wrapped-colour.js';

type ConverterModule = typeof import('../../managed-keys/NativeTokenConverter/contract/index.js');
/** The converter declares no private state. */
export type Converter =
  import('../../managed-keys/NativeTokenConverter/contract/index.js').Contract<undefined>;

/** The converter's build with keys, for a contract that calls it to be proved against. */
export const CONVERTER_BUILD = keyedBuild(
  join(import.meta.dirname, '..', '..'),
  'NativeTokenConverter',
);

/** Thirty-two zero bytes, for the branch of a recipient that is not taken. */
export const UNUSED = { bytes: new Uint8Array(32) };

/** The key a change to the converter is signed with: nobody's, and not in its committee. */
export const OUTSIDE_KEY = sampleSigningKey();

/** Either side of a recipient, as the compiled circuits take it. */
export interface Recipient {
  is_left: boolean;
  left: { bytes: Uint8Array };
  right: { bytes: Uint8Array };
}

export const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** `value`, or a refusal saying the chain was never started. */
function started<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('the chain was not started; its beforeAll failed or has not run');
  }
  return value;
}

/** A chain, a genesis wallet and the converter, once `start` has run. */
export class ConverterOnChain {
  /** Everything measured, printed once the file's tests have run; no test reads it. */
  readonly measurements: Measurement[] = [];
  #chain: LocalChain | undefined;
  #wallet: LocalWallet | undefined;
  #converter: Deployed<Converter> | undefined;
  #build: ContractBuild<Converter> | undefined;

  /** Starts the chain with the genesis wallet `genesisWallet` paying, and deploys the converter. */
  async start(session: ReturnType<typeof chainSession>, genesisWallet: number): Promise<void> {
    const { chain, wallet } = await session.start(genesisWallet);
    this.#chain = chain;
    this.#wallet = wallet;
    const module = await importCompiledModule<ConverterModule>(CONVERTER_BUILD);
    this.#build = compiledContract<Converter>(
      'NativeTokenConverter',
      module.Contract,
      CONVERTER_BUILD,
    );
    this.#converter = await deployConverter(
      contractProviders(wallet, chain.configuration, CONVERTER_BUILD),
      this.#build,
    );
    this.measurements.push(this.#converter.measurement);
  }

  get chain(): LocalChain {
    return started(this.#chain);
  }

  get wallet(): LocalWallet {
    return started(this.#wallet);
  }

  get converter(): Deployed<Converter> {
    return started(this.#converter);
  }

  /** The converter's build sent through the deploy for every other contract, which refuses it. */
  deployThroughTheGeneralDeploy(): Promise<Deployed<Converter>> {
    return deploy(
      contractProviders(this.wallet, this.chain.configuration, CONVERTER_BUILD),
      started(this.#build),
      OWNERLESS,
    );
  }

  /**
   * Asks the chain to hand the converter to a new key, signed by a key that is
   * not in its committee, as anybody holding a key could.
   */
  async changeWithAKeyOutsideItsCommittee(): Promise<unknown> {
    const { providers } = this.converter.through;
    await providers.privateStateProvider.setSigningKey(this.converter.address, OUTSIDE_KEY);
    return createContractMaintenanceTxInterface(
      providers as Ledger9ContractProviders,
      started(this.#build).compiled,
      this.converter.address,
    ).replaceAuthority(sampleSigningKey());
  }

  /** Who may change the converter, as the chain holds it now. */
  async authority(): Promise<{ committee: number; threshold: number; counter: bigint }> {
    const held = (await deployedState(this.converter.through, this.converter.address))
      .maintenanceAuthority;
    return {
      committee: held.committee.length,
      threshold: held.threshold,
      counter: held.counter,
    };
  }

  /** Every way the contract the chain holds now differs from the converter the library releases. */
  async problems(): Promise<string[]> {
    const state = await deployedState(this.converter.through, this.converter.address);
    return converterProblems(state.serialize());
  }

  /** The colour of the converter's pool for `backing`, as 64 hex characters. */
  colourOf(backing: Uint8Array): string {
    return hex(wrappedColour(backing, this.converter.address));
  }

  /** The converter's public balance of each backing colour: its pools, as the ledger holds them. */
  pools(): Promise<Readonly<Record<string, bigint>>> {
    return contractBalances(this.converter.through, this.converter.address);
  }

  /** What the pool for `backing` holds on the ledger. */
  async pool(backing: Uint8Array): Promise<bigint> {
    return (await this.pools())[hex(backing)] ?? 0n;
  }

  /** The wallet's coin key as a mint recipient: the left branch, the right one unused. */
  toWallet(): Recipient {
    const key = { bytes: encodeCoinPublicKey(this.wallet.coinPublicKey) };
    return { is_left: true, left: key, right: UNUSED };
  }

  /** The wallet's user address as a payee: the right branch, the left one unused. */
  toUser(): Recipient {
    const address = { bytes: encodeUserAddress(this.wallet.unshieldedAddress) };
    return { is_left: false, left: UNUSED, right: address };
  }

  /** `done`, with what it measured kept for the summary under `label`, or the circuit's name. */
  async measured<T extends { readonly measurement: Measurement }>(
    done: Promise<T>,
    label?: string,
  ): Promise<T> {
    const result = await done;
    this.measurements.push(
      label === undefined ? result.measurement : { ...result.measurement, label },
    );
    return result;
  }

  /** Wraps `amount` of `backing` to the wallet's key, and checks the coin is of that pool's colour. */
  async wrap(
    backing: Uint8Array,
    amount: bigint,
    label?: string,
  ): Promise<Called<Converter, 'wrap'>> {
    const wrapped = await this.measured(
      call(this.converter, 'wrap', [backing, amount, this.toWallet(), randomBytes(32)]),
      label,
    );
    expect(hex(wrapped.result.color)).toBe(this.colourOf(backing));
    return wrapped;
  }

  /** Waits until the wallet holds the coin with `nonce`, and returns it. */
  async walletCoin(nonce: Uint8Array): Promise<ShieldedCoin> {
    const wanted = hex(nonce);
    const holdings = await this.wallet.waitFor(`the coin with nonce ${wanted}`, (held) =>
      held.shieldedCoins.some((each) => each.nonce === wanted),
    );
    const found = holdings.shieldedCoins.find((each) => each.nonce === wanted);
    if (found === undefined) {
      throw new Error(`the wallet reported the coin with nonce ${wanted} and then did not hold it`);
    }
    return found;
  }

  /** Wraps `amount` of `backing` to the wallet's key, and waits until the wallet holds the coin. */
  async wrapToWallet(backing: Uint8Array, amount: bigint): Promise<ShieldedCoin> {
    const wrapped = await this.wrap(backing, amount);
    return this.walletCoin(wrapped.result.nonce);
  }
}

/**
 * Starts a chain paid for by the genesis wallet `genesisWallet` before the
 * file's tests, with the converter deployed on it, and stops it after them,
 * however far the start got. Each chain test file takes its own genesis
 * wallet, so no two spend the same coins.
 */
export function converterOnChain(genesisWallet: number): ConverterOnChain {
  const session = chainSession();
  const on = new ConverterOnChain();
  beforeAll(() => on.start(session, genesisWallet));
  afterAll(async () => {
    console.log(measurementSummary(on.measurements));
    await session.stop();
  });
  return on;
}
