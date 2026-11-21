// SPDX-License-Identifier: Apache-2.0

/**
 * A contract calling the converter on a real chain. A converter whose two
 * circuits take a contract as recipient is deployed beside the converter as it
 * is, and a generic contract that holds coins wraps, keeps, redeems and is paid
 * through them in one call each. Every transaction the ledger should refuse is
 * tried, and what the pool, the contract and the wallet hold is read back
 * afterwards, so a refusal that left something behind would show.
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  encodeCoinPublicKey,
  encodeContractAddress,
  encodeUserAddress,
} from '@midnight-ntwrk/compact-runtime';
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
  measurementLine,
  type Compiled,
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

type WiderModule = typeof import('../../managed-keys/WiderRecipientConverter/contract/index.js');
type Wider =
  import('../../managed-keys/WiderRecipientConverter/contract/index.js').Contract<undefined>;
type CallerModule = typeof import('../../managed-keys/CallingContract/contract/index.js');
type Caller = import('../../managed-keys/CallingContract/contract/index.js').Contract<undefined>;
type MinterModule = typeof import('../../managed-keys/PublicTokenMinter/contract/index.js');
type ConverterModule =
  typeof import('../../../converter/managed-keys/NativeTokenConverter/contract/index.js');
type Converter =
  import('../../../converter/managed-keys/NativeTokenConverter/contract/index.js').Contract<undefined>;

const WORKSPACE = join(import.meta.dirname, '..', '..');
const WIDER_BUILD = keyedBuild(WORKSPACE, 'WiderRecipientConverter');
const CALLER_BUILD = keyedBuild(WORKSPACE, 'CallingContract');
const CONVERTER_BUILD = keyedBuild(join(WORKSPACE, '..', 'converter'), 'NativeTokenConverter');
const MINTER_BUILD = keyedBuild(WORKSPACE, 'PublicTokenMinter');

/**
 * Which of the chain's genesis wallets pays. Another test file on the same
 * chain uses the first, and two wallets spending one set of coins at once
 * would refuse each other's transactions.
 */
const GENESIS_WALLET = 2;

/** How much NIGHT each flow wraps and redeems, in its smallest unit. */
const AMOUNT = 1_000_000n;
const BACKING = Buffer.from(NIGHT, 'hex');

let chain: LocalChain;
let wallet: LocalWallet;
let wider: Deployed<Wider>;
let converter: Deployed<Converter>;
let caller: Deployed<Caller>;
let callerModule: CallerModule;
let widerCompiled: Compiled<Wider>;
let callerCompiled: Compiled<Caller>;
const measurements: Measurement[] = [];
/** The chain and wallet beforeAll starts, stopped by afterAll however far the start got. */
const session = chainSession();
const refusals: string[] = [];

/** `text` as the thirty-two bytes of a domain separator, padded with zeros. */
const pad = (text: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(Buffer.from(text, 'utf8'));
  return bytes;
};
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const night = (holdings: Holdings): bigint => holdings.unshielded[NIGHT] ?? 0n;
const reference = (address: string): { bytes: Uint8Array } => ({
  bytes: encodeContractAddress(address),
});
const coinKey = (): { bytes: Uint8Array } => ({ bytes: encodeCoinPublicKey(wallet.coinPublicKey) });
const userAddress = (): { bytes: Uint8Array } => ({
  bytes: encodeUserAddress(wallet.unshieldedAddress),
});
const nonce = (): Uint8Array => randomBytes(32);

/** NIGHT the contract at `address` holds on the ledger: for a converter, its pool. */
async function nightHeldBy(
  deployed: Deployed<Wider> | Deployed<Converter> | Deployed<Caller>,
): Promise<bigint> {
  return (await contractBalances(deployed.through, deployed.address))[NIGHT] ?? 0n;
}

/** The coin the calling contract's ledger says it holds, if it holds one. */
async function heldByCaller(): Promise<
  { readonly color: Uint8Array; readonly value: bigint } | undefined
> {
  const state = callerModule.ledger(await contractState(caller.through, caller.address));
  return state.holding ? state.coins.lookup(state.heldNonce) : undefined;
}

/** Every message in an error and the errors it was caused by, outermost first. */
function messages(error: unknown): string {
  const found: string[] = [];
  for (let at: unknown = error; at instanceof Error && found.length < 8; at = at.cause) {
    found.push(`${at.name}: ${at.message}`);
  }
  return found.length === 0 ? String(error) : found.join('\n  caused by ');
}

/** The refusal `attempt` ends in, recorded for the summary. Throws if it was accepted. */
async function refusal(label: string, attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt;
  } catch (error) {
    const text = messages(error);
    refusals.push(`${label}\n  ${text}`);
    return text;
  }
  throw new Error(`${label} was accepted, and the ledger or the circuit should have refused it`);
}

async function measured<T extends { readonly measurement: Measurement }>(
  done: Promise<T>,
): Promise<T> {
  const result = await done;
  measurements.push(result.measurement);
  return result;
}

/**
 * How many coins of `colour` the wallet holds once it has synced past every
 * transaction the node has finalized. A redeem must send the coin it destroys
 * to the burn address: sent to a key the submitting wallet holds, it would
 * come back here and could be redeemed again, emptying the pool.
 */
async function walletCoinsOf(colour: string): Promise<number> {
  return (await wallet.holdings()).shieldedCoins.filter((each) => each.colour === colour).length;
}

/** Waits until the wallet holds `amount` NIGHT. */
async function walletNightIs(amount: bigint): Promise<Holdings> {
  return wallet.waitFor(`${String(amount)} NIGHT`, (held) => night(held) === amount);
}

/** Waits until the wallet holds a coin of `colour` worth AMOUNT, and returns it. */
async function walletCoinOf(colour: string): Promise<ShieldedCoin> {
  const holdings = await wallet.waitFor(`a shielded coin of colour ${colour}`, (held) =>
    held.shieldedCoins.some((each) => each.colour === colour && each.value === AMOUNT),
  );
  const found = holdings.shieldedCoins.find(
    (each) => each.colour === colour && each.value === AMOUNT,
  );
  if (found === undefined) {
    throw new Error(`the wallet reported a coin of colour ${colour} and then did not hold it`);
  }
  return found;
}

beforeAll(async () => {
  ({ chain, wallet } = await session.start(GENESIS_WALLET));

  const widerModule = await importCompiledModule<WiderModule>(WIDER_BUILD);
  widerCompiled = compiledContract<Wider>(
    'WiderRecipientConverter',
    widerModule.Contract,
    WIDER_BUILD,
  );
  wider = await deploy(
    contractProviders(wallet, chain.configuration, WIDER_BUILD),
    widerCompiled,
    [],
  );
  measurements.push(wider.measurement);

  const converterModule = await importCompiledModule<ConverterModule>(CONVERTER_BUILD);
  const converterCompiled = compiledContract<Converter>(
    'NativeTokenConverter',
    converterModule.Contract,
    CONVERTER_BUILD,
  );
  converter = await deploy(
    contractProviders(wallet, chain.configuration, CONVERTER_BUILD),
    converterCompiled,
    ['Wrapped NIGHT', 'wNIGHT'],
  );
  measurements.push(converter.measurement);

  callerModule = await importCompiledModule<CallerModule>(CALLER_BUILD);
  callerCompiled = compiledContract<Caller>('CallingContract', callerModule.Contract, CALLER_BUILD);
  const callees = [
    { address: wider.address, buildDirectory: WIDER_BUILD },
    { address: converter.address, buildDirectory: CONVERTER_BUILD },
  ];
  caller = await deploy(
    contractProviders(wallet, chain.configuration, CALLER_BUILD, { callees }),
    callerCompiled,
    [],
  );
  measurements.push(caller.measurement);
});

afterAll(async () => {
  console.log(
    `\nmeasured on ${process.platform} ${process.arch}\n${measurements.map(measurementLine).join('\n')}\n`,
  );
  console.log(`\nrefusals, as each was given\n${refusals.join('\n')}\n`);
  await session.stop();
});

/** Thirty-two zero bytes, for the branch of a recipient that is not taken. */
const UNUSED = { bytes: new Uint8Array(32) };

/** A coin recipient: the wallet's coin key. */
const toWallet = (): {
  is_left: boolean;
  left: { bytes: Uint8Array };
  right: { bytes: Uint8Array };
} => ({
  is_left: true,
  left: coinKey(),
  right: UNUSED,
});

describe('a contract that holds coins, calling the converter with the wider recipient', () => {
  let nightBefore: bigint;

  it('wraps public tokens to itself and keeps the minted coin, which is of the pool colour', async () => {
    nightBefore = night(await wallet.holdings());
    await measured(
      call(caller, 'wrapToSelf', [reference(wider.address), BACKING, AMOUNT, nonce()]),
    );

    const held = await heldByCaller();
    expect(hex(held?.color ?? new Uint8Array())).toBe(hex(wrappedColour(BACKING, wider.address)));
    expect(held?.value).toBe(AMOUNT);
    expect(await nightHeldBy(wider)).toBe(AMOUNT);
    await walletNightIs(nightBefore - AMOUNT);
  });

  it('is refused a payout to itself that it does not receive, and keeps its coin and the pool its backing', async () => {
    const text = await refusal(
      'a payout to the calling contract that it does not receive',
      call(caller, 'redeemHeldToSelfUnreceived', [
        reference(wider.address),
        reference(wider.address),
        BACKING,
      ]),
    );
    // The node's code for a public payment that no contract in the
    // transaction receives: an unshielded spend its effects do not account for.
    expect(text).toMatch(/Invalid Transaction: Custom error: 214/);

    expect((await heldByCaller())?.value).toBe(AMOUNT);
    expect(await nightHeldBy(wider)).toBe(AMOUNT);
    expect(await nightHeldBy(caller)).toBe(0n);
  });

  it('sends the coin it holds to the converter and redeems it to a user address', async () => {
    const colour = hex(wrappedColour(BACKING, wider.address));
    const coinsBefore = await walletCoinsOf(colour);
    await measured(
      call(caller, 'redeemHeld', [
        reference(wider.address),
        reference(wider.address),
        BACKING,
        userAddress(),
      ]),
    );

    expect(await heldByCaller()).toBeUndefined();
    expect(await nightHeldBy(wider)).toBe(0n);
    await walletNightIs(nightBefore);
    expect(await walletCoinsOf(colour)).toBe(coinsBefore);
  });

  it('is refused a mint to itself that it does not claim, and nothing moves', async () => {
    const text = await refusal(
      'a mint to the calling contract that it does not claim',
      call(caller, 'wrapToSelfUnclaimed', [reference(wider.address), BACKING, AMOUNT, nonce()]),
    );
    // What this measures is Midnight.js refusing before anything is proved.
    // The node's own verdict is not measured here: with that check switched
    // off in a patched copy of Midnight.js, outside this test, the node
    // refused the same transaction with code 218, coin commitments that do
    // not match the shielded receives the effects claim.
    expect(text).toMatch(/must be claimed as received by that contract/);

    expect(await heldByCaller()).toBeUndefined();
    expect(await nightHeldBy(wider)).toBe(0n);
    expect(night(await wallet.holdings())).toBe(nightBefore);
  });

  it('redeems a coin it holds with itself as the payee and receives the payout in the same call', async () => {
    const colour = hex(wrappedColour(BACKING, wider.address));
    const coinsBefore = await walletCoinsOf(colour);
    await measured(
      call(caller, 'wrapToSelf', [reference(wider.address), BACKING, AMOUNT, nonce()]),
    );
    await measured(
      call(caller, 'redeemHeldToSelf', [
        reference(wider.address),
        reference(wider.address),
        BACKING,
      ]),
    );

    expect(await heldByCaller()).toBeUndefined();
    expect(await nightHeldBy(wider)).toBe(0n);
    expect(await nightHeldBy(caller)).toBe(AMOUNT);
    await walletNightIs(nightBefore - AMOUNT);
    expect(await walletCoinsOf(colour)).toBe(coinsBefore);
  });
});

describe('the wider converter, called by a wallet', () => {
  it('refuses in the circuit a mint to the converter itself', async () => {
    const itself = { is_left: false, left: UNUSED, right: reference(wider.address) };
    const text = await refusal(
      'wrap naming the converter as recipient',
      call(wider, 'wrap', [BACKING, AMOUNT, itself, nonce()]),
    );
    expect(text).toMatch(/the recipient is this contract, which could never spend the coin/);
  });

  it('refuses it too when the branch not taken carries a key, which a comparison of the whole value would miss', async () => {
    const disguised = { is_left: false, left: coinKey(), right: reference(wider.address) };
    const text = await refusal(
      'wrap naming the converter as recipient, with a key in the branch not taken',
      call(wider, 'wrap', [BACKING, AMOUNT, disguised, nonce()]),
    );
    expect(text).toMatch(/the recipient is this contract, which could never spend the coin/);
  });

  it('refuses in the circuit a payout to the converter itself, and the coin stays with the wallet', async () => {
    const colour = hex(wrappedColour(BACKING, wider.address));
    await measured(call(wider, 'wrap', [BACKING, AMOUNT, toWallet(), nonce()]));
    const coin = await walletCoinOf(colour);
    const payee = { is_left: true, left: reference(wider.address), right: userAddress() };
    // The branch not taken carries the wallet's own address, so the payout is
    // refused for naming the converter and not because the value is unusual.
    const text = await refusal(
      'redeem naming the converter as payee',
      call(wider, 'redeem', [BACKING, shieldedCoinInfo(coin), payee]),
    );
    expect(text).toMatch(
      /the payout address is this contract, which would keep the payout in the pool/,
    );
    expect(await walletCoinOf(colour)).toEqual(coin);
    expect(await nightHeldBy(wider)).toBe(AMOUNT);
  });
});

describe('a coin the wallet gives the contract', () => {
  it('is taken and kept in a call of its own, and redeemed through the contract', async () => {
    const colour = hex(wrappedColour(BACKING, wider.address));
    const coin = await walletCoinOf(colour);
    const nightBefore = night(await wallet.holdings());
    await measured(call(caller, 'deposit', [shieldedCoinInfo(coin)]));

    expect(hex((await heldByCaller())?.color ?? new Uint8Array())).toBe(colour);
    await wallet.waitFor('no coin of the pool colour', (each) =>
      each.shieldedCoins.every((c) => c.colour !== colour),
    );

    await measured(
      call(caller, 'redeemHeld', [
        reference(wider.address),
        reference(wider.address),
        BACKING,
        userAddress(),
      ]),
    );
    expect(await heldByCaller()).toBeUndefined();
    expect(await nightHeldBy(wider)).toBe(0n);
    await walletNightIs(nightBefore + AMOUNT);
    expect(await walletCoinsOf(colour)).toBe(0);
  });

  it('cannot be minted to the wallet and taken by the contract in one transaction', async () => {
    const poolBefore = await nightHeldBy(wider);
    const text = await refusal(
      'wrap to the wallet, then deposit that coin, in one transaction',
      // The harness holds providers for any circuit; a scope wants them for one.
      withContractScopedTransaction<Wider, 'wrap'>(
        wider.through.providers as Ledger9ContractProviders<Wider, 'wrap'>,
        async (scope) => {
          const wrapped = await wider.contract.callTx.wrap(
            scope,
            BACKING,
            AMOUNT,
            toWallet(),
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
    expect(await nightHeldBy(wider)).toBe(poolBefore);
  });
});

describe('a contract that holds coins, calling the converter as it is', () => {
  it('has the converter mint to a wallet key, takes that coin, and redeems it there', async () => {
    const colour = hex(wrappedColour(BACKING, converter.address));
    const nightBefore = night(await wallet.holdings());
    await measured(
      call(caller, 'wrapThrough', [
        reference(converter.address),
        BACKING,
        AMOUNT,
        coinKey(),
        nonce(),
      ]),
    );
    const coin = await walletCoinOf(colour);
    expect(await nightHeldBy(converter)).toBe(AMOUNT);

    await measured(call(caller, 'deposit', [shieldedCoinInfo(coin)]));
    expect(hex((await heldByCaller())?.color ?? new Uint8Array())).toBe(colour);
    await measured(
      call(caller, 'redeemHeldThrough', [
        reference(converter.address),
        reference(converter.address),
        BACKING,
        userAddress(),
      ]),
    );

    expect(await heldByCaller()).toBeUndefined();
    expect(await nightHeldBy(converter)).toBe(0n);
    await walletNightIs(nightBefore);
  });
});

/** A coin as a circuit takes it, of `colour` and worth `value`, that no wallet holds. */
const unheldCoin = (
  colour: Uint8Array,
  value: bigint,
): { nonce: Uint8Array; color: Uint8Array; value: bigint } => ({
  nonce: nonce(),
  color: colour,
  value,
});

describe("the wider converter's own checks", () => {
  let secondConverter: Deployed<Wider>;
  let otherBacking: Uint8Array;
  const recipient = (
    isLeft: boolean,
    left: { bytes: Uint8Array },
    right: { bytes: Uint8Array },
  ) => ({
    is_left: isLeft,
    left,
    right,
  });
  const ownColour = (): Uint8Array => wrappedColour(BACKING, wider.address);

  beforeAll(async () => {
    const minterModule = await importCompiledModule<MinterModule>(MINTER_BUILD);
    const minter = await deploy(
      contractProviders(wallet, chain.configuration, MINTER_BUILD),
      compiledContract('PublicTokenMinter', minterModule.Contract, MINTER_BUILD),
      [],
    );
    measurements.push(minter.measurement);
    const minted = await measured(
      call(minter, 'mint', [Buffer.from(pad('another backing token')), AMOUNT, userAddress()]),
    );
    otherBacking = minted.result;
    await wallet.waitFor(
      `public tokens of colour ${hex(otherBacking)}`,
      (held) => held.unshielded[hex(otherBacking)] === AMOUNT,
    );
    secondConverter = await deploy(
      contractProviders(wallet, chain.configuration, WIDER_BUILD),
      widerCompiled,
      [],
    );
    measurements.push(secondConverter.measurement);
  });

  it('refuses to redeem a coin of another pool of the same converter, and both pools stay', async () => {
    await measured(call(wider, 'wrap', [BACKING, AMOUNT, toWallet(), nonce()]));
    await measured(call(wider, 'wrap', [otherBacking, AMOUNT, toWallet(), nonce()]));
    const otherPoolCoin = await walletCoinOf(hex(wrappedColour(otherBacking, wider.address)));
    const pool = await contractBalances(wider.through, wider.address);
    const text = await refusal(
      'redeem for NIGHT of a coin from the pool of another backing token',
      call(wider, 'redeem', [
        BACKING,
        shieldedCoinInfo(otherPoolCoin),
        recipient(false, UNUSED, userAddress()),
      ]),
    );
    expect(text).toMatch(/the coin is not of this contract's colour for that backing token/);
    expect(await contractBalances(wider.through, wider.address)).toEqual(pool);
    expect(await walletCoinOf(hex(wrappedColour(otherBacking, wider.address)))).toEqual(
      otherPoolCoin,
    );
  });

  it('refuses to redeem a coin of the same backing from another converter, and both pools stay', async () => {
    await measured(call(secondConverter, 'wrap', [BACKING, AMOUNT, toWallet(), nonce()]));
    const foreignCoin = await walletCoinOf(hex(wrappedColour(BACKING, secondConverter.address)));
    const pool = await nightHeldBy(wider);
    const text = await refusal(
      "redeem of another converter's coin",
      call(wider, 'redeem', [
        BACKING,
        shieldedCoinInfo(foreignCoin),
        recipient(false, UNUSED, userAddress()),
      ]),
    );
    expect(text).toMatch(/the coin is not of this contract's colour for that backing token/);
    expect(pool).toBe(AMOUNT);
    expect(await nightHeldBy(wider)).toBe(pool);
    expect(await nightHeldBy(secondConverter)).toBe(AMOUNT);
  });

  // These are refused by the circuit as the wallet runs it, before anything
  // is proved or reaches the node.
  it('refuses to wrap an amount of zero', async () => {
    const text = await refusal(
      'wrap of zero',
      call(wider, 'wrap', [BACKING, 0n, toWallet(), nonce()]),
    );
    expect(text).toMatch(/failed assert: the amount to wrap is zero/);
  });

  it.each([
    ['the zero coin key', () => recipient(true, UNUSED, UNUSED)],
    [
      'the zero coin key, with an address in the branch not taken',
      () => recipient(true, UNUSED, reference(wider.address)),
    ],
    ['the zero contract address', () => recipient(false, UNUSED, UNUSED)],
    [
      'the zero contract address, with a key in the branch not taken',
      () => recipient(false, coinKey(), UNUSED),
    ],
  ])('refuses to wrap to %s', async (what, to) => {
    const text = await refusal(
      `wrap to ${what}`,
      call(wider, 'wrap', [BACKING, AMOUNT, to(), nonce()]),
    );
    expect(text).toMatch(/failed assert: the recipient is the zero key or the zero address/);
  });

  it.each([
    ['the zero user address', () => recipient(false, UNUSED, UNUSED)],
    [
      'the zero user address, with an address in the branch not taken',
      () => recipient(false, reference(wider.address), UNUSED),
    ],
    ['the zero contract address', () => recipient(true, UNUSED, UNUSED)],
    [
      'the zero contract address, with a user address in the branch not taken',
      () => recipient(true, UNUSED, userAddress()),
    ],
  ])('refuses to redeem to %s', async (what, to) => {
    const text = await refusal(
      `redeem to ${what}`,
      call(wider, 'redeem', [BACKING, unheldCoin(ownColour(), AMOUNT), to()]),
    );
    expect(text).toMatch(
      /failed assert: the payout address is the zero address, which nobody can ever spend from/,
    );
  });

  it('refuses to redeem a coin worth nothing', async () => {
    const text = await refusal(
      'redeem of a coin worth nothing',
      call(wider, 'redeem', [
        BACKING,
        unheldCoin(ownColour(), 0n),
        recipient(false, UNUSED, userAddress()),
      ]),
    );
    expect(text).toMatch(/failed assert: the coin is worth nothing/);
  });
});
