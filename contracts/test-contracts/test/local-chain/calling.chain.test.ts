// SPDX-License-Identifier: Apache-2.0

/**
 * A contract calling the converter on a real chain: taking coins, minted to it
 * in the call that wraps or given to it by a wallet, and redeeming a coin it
 * holds, with the backing paid to a user address or to itself. The ledger
 * takes a mint or a payout to a contract only when that contract claims it in
 * the same transaction, so the mint it does not claim and the payout it does
 * not receive are tried too, and what the pool, the contract and the wallet
 * hold is read back afterwards, so a refusal that left something behind would
 * show. Each test deploys its own calling contract and makes the coins it
 * needs; the calling contract holds at most one coin, read back from its own
 * public state.
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { encodeContractAddress, encodeUserAddress } from '@midnight-ntwrk/compact-runtime';
import {
  withContractScopedTransaction,
  type Ledger9ContractProviders,
  type Ledger9TransactionContext,
} from '@midnight-ntwrk/midnight-js-contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keyedBuild } from '@native-token-converter/toolchain/keyed-builds';
import {
  call,
  compiledContract,
  contractBalances,
  contractProviders,
  contractState,
  deploy,
  importCompiledModule,
  type Deployed,
} from '@native-token-converter/local-chain/contracts';
import { NIGHT, shieldedCoinInfo, type Holdings } from '@native-token-converter/local-chain/wallet';
import {
  CONVERTER_BUILD,
  converterOnChain,
  hex,
  type Converter,
} from '../../../converter/test/local-chain/converter-on-chain.js';

type CallerModule = typeof import('../../managed-keys/CallingContract/contract/index.js');
type Caller = import('../../managed-keys/CallingContract/contract/index.js').Contract<undefined>;

const CALLER_BUILD = keyedBuild(join(import.meta.dirname, '..', '..'), 'CallingContract');

/**
 * Which of the chain's genesis wallets pays. Every chain test file takes its
 * own, so no two spend the same coins.
 */
const GENESIS_WALLET = 2;

/** How much NIGHT each flow wraps and redeems, in its smallest unit. */
const AMOUNT = 1_000_000n;
const BACKING = Buffer.from(NIGHT, 'hex');

const on = converterOnChain(GENESIS_WALLET);
let callerModule: CallerModule;
const refusals: string[] = [];

beforeAll(async () => {
  callerModule = await importCompiledModule<CallerModule>(CALLER_BUILD);
});

afterAll(() => {
  console.log(`\nrefusals, as each was given\n${refusals.join('\n')}\n`);
});

/** A contract as a circuit takes a reference to it. */
const reference = (address: string): { bytes: Uint8Array } => ({
  bytes: encodeContractAddress(address),
});
const nonce = (): Uint8Array => randomBytes(32);
const night = (holdings: Holdings): bigint => holdings.unshielded[NIGHT] ?? 0n;
/** The wallet's user address, as the calling contract's `to` takes it. */
const userAddress = (): { bytes: Uint8Array } => ({
  bytes: encodeUserAddress(on.wallet.unshieldedAddress),
});

/** A calling contract deployed for one test, holding nothing, able to call the converter. */
async function freshCaller(): Promise<Deployed<Caller>> {
  const callees = [{ address: on.converter.address, buildDirectory: CONVERTER_BUILD }];
  return on.measured(
    deploy(
      contractProviders(on.wallet, on.chain.configuration, CALLER_BUILD, { callees }),
      compiledContract<Caller>('CallingContract', callerModule.Contract, CALLER_BUILD),
    ),
  );
}

/** The coin `caller`'s public state says it holds, if it holds one. */
async function heldBy(
  caller: Deployed<Caller>,
): Promise<{ readonly color: Uint8Array; readonly value: bigint } | undefined> {
  const state = callerModule.ledger(await contractState(caller.through, caller.address));
  return state.holding ? state.coins.lookup(state.heldNonce) : undefined;
}

/** NIGHT the calling contract holds on the ledger. */
async function nightOf(caller: Deployed<Caller>): Promise<bigint> {
  return (await contractBalances(caller.through, caller.address))[NIGHT] ?? 0n;
}

/** Every message in an error and the errors it was caused by, outermost first. */
function errorMessages(error: unknown): string {
  const found: string[] = [];
  for (let at: unknown = error; at instanceof Error && found.length < 8; at = at.cause) {
    found.push(`${at.name}: ${at.message}`);
  }
  return found.length === 0 ? String(error) : found.join('\n  caused by ');
}

/**
 * What refused `attempt`, as every message in the error and its causes, kept
 * for the summary: the circuit, Midnight.js or the node. Throws if it was
 * accepted, naming what was tried.
 */
async function refusal(what: string, attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt;
  } catch (error) {
    const text = errorMessages(error);
    refusals.push(`${what}\n  ${text}`);
    return text;
  }
  throw new Error(`${what} was accepted, and should have been refused`);
}

/** The NIGHT the wallet holds, synced to the chain's tip. */
async function walletNight(): Promise<bigint> {
  return night(await on.wallet.holdings());
}

/** Waits until the wallet holds `amount` NIGHT. */
function walletNightIs(amount: bigint): Promise<Holdings> {
  return on.wallet.waitFor(`${String(amount)} NIGHT`, (held) => night(held) === amount);
}

/** How many coins of `colour` the wallet holds, synced to the chain's tip. */
async function walletCoinsOf(colour: string): Promise<number> {
  const held = await on.wallet.holdings();
  return held.shieldedCoins.filter((each) => each.colour === colour).length;
}

/** A calling contract deployed for one test, holding a coin of AMOUNT it had the converter mint to it. */
async function callerHoldingACoin(): Promise<Deployed<Caller>> {
  const caller = await freshCaller();
  await on.measured(
    call(caller, 'wrapToSelf', [reference(on.converter.address), BACKING, AMOUNT, nonce()]),
  );
  expect((await heldBy(caller))?.value).toBe(AMOUNT);
  return caller;
}

describe('a contract the converter mints to', () => {
  it('wraps public tokens to itself and keeps the minted coin, which is of the pool colour', async () => {
    const caller = await freshCaller();
    const nightBefore = await walletNight();
    const poolBefore = await on.pool(BACKING);
    await on.measured(
      call(caller, 'wrapToSelf', [reference(on.converter.address), BACKING, AMOUNT, nonce()]),
    );

    const held = await heldBy(caller);
    expect(hex(held?.color ?? new Uint8Array())).toBe(on.colourOf(BACKING));
    expect(held?.value).toBe(AMOUNT);
    expect(await on.pool(BACKING)).toBe(poolBefore + AMOUNT);
    await walletNightIs(nightBefore - AMOUNT);
  });

  it('is refused a mint to itself that it does not claim, and nothing moves', async () => {
    const caller = await freshCaller();
    const nightBefore = await walletNight();
    const poolBefore = await on.pool(BACKING);
    const text = await refusal(
      'a mint to the calling contract that it does not claim',
      call(caller, 'wrapToSelfUnclaimed', [
        reference(on.converter.address),
        BACKING,
        AMOUNT,
        nonce(),
      ]),
    );
    // What this measures is Midnight.js refusing before anything is proved.
    // The node's own verdict is not measured here: with that check switched
    // off in a patched copy of Midnight.js, outside this test, the node
    // refused the same transaction with code 218, coin commitments that do
    // not match the shielded receives the effects claim.
    expect(text).toMatch(/must be claimed as received by that contract/);

    expect(await heldBy(caller)).toBeUndefined();
    expect(await on.pool(BACKING)).toBe(poolBefore);
    expect(await walletNight()).toBe(nightBefore);
  });
});

describe('a coin the wallet gives the contract', () => {
  it('is taken and kept in a call of its own, and redeemed through the contract', async () => {
    const caller = await freshCaller();
    const colour = on.colourOf(BACKING);
    const coinsBefore = await walletCoinsOf(colour);
    const coin = await on.wrapToWallet(BACKING, AMOUNT);
    const nightBefore = await walletNight();
    await on.measured(call(caller, 'deposit', [shieldedCoinInfo(coin)]));

    expect(hex((await heldBy(caller))?.color ?? new Uint8Array())).toBe(colour);
    await on.wallet.waitFor('the given coin gone from the wallet', (held) =>
      held.shieldedCoins.every((each) => each.nonce !== coin.nonce),
    );

    const poolBefore = await on.pool(BACKING);
    await on.measured(
      call(caller, 'redeemHeld', [
        reference(on.converter.address),
        reference(on.converter.address),
        BACKING,
        userAddress(),
      ]),
    );
    expect(await heldBy(caller)).toBeUndefined();
    expect(await on.pool(BACKING)).toBe(poolBefore - AMOUNT);
    await walletNightIs(nightBefore + AMOUNT);
    expect(await walletCoinsOf(colour)).toBe(coinsBefore);
  });

  it('cannot be minted to the wallet and taken by the contract in one transaction', async () => {
    const caller = await freshCaller();
    const converter = on.converter;
    const poolBefore = await on.pool(BACKING);
    const text = await refusal(
      'wrap to the wallet, then deposit that coin, in one transaction',
      // The harness holds providers for any circuit; a scope wants them for one.
      withContractScopedTransaction<Converter, 'wrap'>(
        converter.through.providers as Ledger9ContractProviders<Converter, 'wrap'>,
        async (scope) => {
          const wrapped = await converter.contract.callTx.wrap(
            scope,
            BACKING,
            AMOUNT,
            on.toWallet(),
            nonce(),
          );
          // A scope is typed to one contract, so a call to a second contract
          // in it does not typecheck; it is cast here to see what Midnight.js
          // does with one at run time.
          const sameScope = scope as unknown as Ledger9TransactionContext<Caller, 'deposit'>;
          await caller.contract.callTx.deposit(sameScope, wrapped.private.result);
        },
      ),
    );
    expect(text).toMatch(/ScopedTransactionIdentityMismatchError/);
    expect(await on.pool(BACKING)).toBe(poolBefore);
  });
});

describe('a contract that holds a coin, redeeming it through the converter', () => {
  it('sends the coin it holds to the converter and redeems it to a user address', async () => {
    const colour = on.colourOf(BACKING);
    const coinsBefore = await walletCoinsOf(colour);
    const caller = await callerHoldingACoin();
    const nightBefore = await walletNight();
    const poolBefore = await on.pool(BACKING);
    await on.measured(
      call(caller, 'redeemHeld', [
        reference(on.converter.address),
        reference(on.converter.address),
        BACKING,
        userAddress(),
      ]),
    );

    expect(await heldBy(caller)).toBeUndefined();
    expect(await on.pool(BACKING)).toBe(poolBefore - AMOUNT);
    await walletNightIs(nightBefore + AMOUNT);
    expect(await walletCoinsOf(colour)).toBe(coinsBefore);
  });

  it('redeems a coin it holds with itself as the payee and receives the payout in the same call', async () => {
    const colour = on.colourOf(BACKING);
    const coinsBefore = await walletCoinsOf(colour);
    const caller = await callerHoldingACoin();
    const nightBefore = await walletNight();
    const poolBefore = await on.pool(BACKING);
    await on.measured(
      call(caller, 'redeemHeldToSelf', [
        reference(on.converter.address),
        reference(on.converter.address),
        BACKING,
      ]),
    );

    expect(await heldBy(caller)).toBeUndefined();
    expect(await on.pool(BACKING)).toBe(poolBefore - AMOUNT);
    expect(await nightOf(caller)).toBe(AMOUNT);
    expect(await walletNight()).toBe(nightBefore);
    expect(await walletCoinsOf(colour)).toBe(coinsBefore);
  });

  it('is refused a payout to itself that it does not receive, and keeps its coin and the pool its backing', async () => {
    const caller = await callerHoldingACoin();
    const poolBefore = await on.pool(BACKING);
    const text = await refusal(
      'a payout to the calling contract that it does not receive',
      call(caller, 'redeemHeldToSelfUnreceived', [
        reference(on.converter.address),
        reference(on.converter.address),
        BACKING,
      ]),
    );
    // The node's code for a public payment that no contract in the
    // transaction receives: an unshielded spend its effects do not account for.
    expect(text).toMatch(/Invalid Transaction: Custom error: 214/);

    expect((await heldBy(caller))?.value).toBe(AMOUNT);
    expect(await on.pool(BACKING)).toBe(poolBefore);
    expect(await nightOf(caller)).toBe(0n);
  });
});
