// SPDX-License-Identifier: Apache-2.0

/**
 * The contract, run.
 *
 * These go through the compiled circuits and read the ledger effects they
 * produce, so what is checked is what the chain would be asked to do: which
 * colour came in, which colour went out, and how much of each.
 */

import {
  createCircuitContext,
  encodeCoinPublicKey,
  encodeRawTokenType,
  encodeUserAddress,
  sampleContractAddress,
  sampleRawTokenType,
  sampleUserAddress,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { Contract } from '../contracts/managed/contract/index.js';
import { isWrappedNoteOf, wrappedColour } from '../src/wrapped-colour.js';

interface Coin {
  readonly nonce: Uint8Array;
  readonly color: Uint8Array;
  readonly value: bigint;
}

/** A shielded output a circuit created: a coin, and who it went to. */
interface ShieldedOutput {
  readonly coinInfo: Coin;
  readonly recipient: { readonly is_left: boolean; readonly left: { readonly bytes: Uint8Array } };
}

/** The shielded coins a circuit took in and put out. */
interface ZswapState {
  readonly inputs: readonly Coin[];
  readonly outputs: readonly ShieldedOutput[];
}

/** The ledger bookkeeping a circuit asks for, as the runtime reports it. */
interface Effects {
  readonly shieldedMints: Map<string, bigint>;
  readonly unshieldedInputs: Map<{ raw: string }, bigint>;
  readonly unshieldedOutputs: Map<{ raw: string }, bigint>;
  readonly claimedUnshieldedSpends: Map<[{ raw: string }, { address: string }], bigint>;
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const someColour = (): Uint8Array => encodeRawTokenType(sampleRawTokenType());

/** What a call asked the ledger to move, by colour. */
const byColour = (entries: Map<{ raw: string }, bigint>): Array<[string, bigint]> =>
  [...entries.entries()].map(([token, amount]) => [token.raw, amount]);

describe('the converter', () => {
  let contract: Contract;
  let converterAddress: string;
  let state: unknown;
  let backing: Uint8Array;

  beforeEach(async () => {
    contract = new Contract({});
    converterAddress = sampleContractAddress();
    backing = someColour();
    const built = await contract.initialState(
      {
        initialZswapLocalState: { coinPublicKey: sampleContractAddress() },
        initialPrivateState: {},
      } as never,
      'Wrapped',
      'w',
    );
    state = built.currentContractState.data;
  });

  const context = (circuit: string): never =>
    createCircuitContext(
      circuit,
      converterAddress,
      sampleContractAddress(),
      state as never,
      {},
    ) as never;

  const effectsOf = (result: { context: unknown }): Effects =>
    (result.context as { callContext: { currentQueryContext: { effects: Effects } } }).callContext
      .currentQueryContext.effects;

  const shieldedOf = (result: { context: unknown }): ZswapState =>
    (result.context as { callContext: { currentZswapLocalState: ZswapState } }).callContext
      .currentZswapLocalState;

  /** The all-zero coin public key: coins sent there can never be spent again. */
  const BURN_KEY = '00'.repeat(32);

  const destroyed = (result: { context: unknown }): bigint[] =>
    shieldedOf(result)
      .outputs.filter(
        (output) => output.recipient.is_left && hex(output.recipient.left.bytes) === BURN_KEY,
      )
      .map((output) => output.coinInfo.value);

  // A fresh nonce per call. The caller owes uniqueness per pool, and a test
  // that reuses one is modelling the mistake rather than the practice. A coin
  // public key is 32 bytes, which is what the address sampler produces.
  let nonces = 0;
  const freshNonce = (): Uint8Array => {
    nonces += 1;
    const nonce = new Uint8Array(32);
    new DataView(nonce.buffer).setUint32(0, nonces);
    return nonce;
  };

  const wrap = async (
    amount: bigint,
    colour: Uint8Array = backing,
    to = { bytes: encodeCoinPublicKey(sampleContractAddress()) },
  ) => contract.impureCircuits.wrap(context('wrap'), colour, amount, to, freshNonce());

  const redeem = async (coin: Coin, colour: Uint8Array = backing, to = sampleUserAddress()) =>
    contract.impureCircuits.redeem(context('redeem'), colour, coin as never, {
      bytes: encodeUserAddress(to),
    });

  /** Thirty-two zero bytes: an address nobody holds and nobody can spend from. */
  const NOBODY = new Uint8Array(32);

  describe('wrapping', () => {
    it('mints the note colour a client derives for that backing colour', async () => {
      const { result } = await wrap(1234n);
      expect(hex(result.color)).toBe(hex(wrappedColour(backing, converterAddress)));
    });

    it('takes in exactly what it mints, of exactly the colour it mints against', async () => {
      const wrapped = await wrap(1234n);
      const effects = effectsOf(wrapped);
      expect(wrapped.result.value).toBe(1234n);
      expect(byColour(effects.unshieldedInputs)).toEqual([[hex(backing), 1234n]]);
      expect([...effects.shieldedMints.entries()]).toEqual([[hex(backing), 1234n]]);
    });

    it('mints a note a client then recognises as this pool\'s', async () => {
      const { result } = await wrap(1234n);
      expect(isWrappedNoteOf(result.color, backing, converterAddress)).toBe(true);
      expect(isWrappedNoteOf(result.color, someColour(), converterAddress)).toBe(false);
    });

    it('refuses to mint to the zero recipient, which nobody could spend', async () => {
      await expect(wrap(1n, backing, { bytes: NOBODY })).rejects.toThrow(/invalid recipient/);
    });

    it('cannot be asked for more than the protocol can mint', async () => {
      await expect(wrap(2n ** 64n)).rejects.toThrow();
    });

    it('pays nothing out', async () => {
      expect(byColour(effectsOf(await wrap(1234n)).unshieldedOutputs)).toEqual([]);
    });

    it('brings a different pool into existence for a different backing colour', async () => {
      const other = someColour();
      const mine = await wrap(1n);
      const theirs = await wrap(1n, other);
      expect(hex(mine.result.color)).not.toBe(hex(theirs.result.color));
      expect(hex(theirs.result.color)).toBe(hex(wrappedColour(other, converterAddress)));
    });
  });

  describe('redeeming', () => {
    it("refuses a coin that is not this converter's note for that backing colour", async () => {
      const stranger: Coin = { nonce: new Uint8Array(32), color: someColour(), value: 10n };
      await expect(redeem(stranger)).rejects.toThrow(/wrong token/);
    });

    it("refuses the converter's own note against a different backing colour", async () => {
      const { result } = await wrap(10n);
      await expect(redeem(result, someColour())).rejects.toThrow(/wrong token/);
    });

    it('refuses to pay out to the zero address, which nobody could spend from', async () => {
      const { result } = await wrap(1234n);
      await expect(
        contract.impureCircuits.redeem(context('redeem'), backing, result as never, {
          bytes: NOBODY,
        }),
      ).rejects.toThrow(/zero address/);
    });

    it('pays out the backing colour, and nothing else', async () => {
      const { result } = await wrap(1234n);
      const effects = effectsOf(await redeem(result));
      expect(byColour(effects.unshieldedOutputs)).toEqual([[hex(backing), 1234n]]);
    });

    it('pays out exactly what the note is worth', async () => {
      for (const amount of [1n, 7n, 1234n, 18446744073709551615n]) {
        const { result } = await wrap(amount);
        const effects = effectsOf(await redeem(result));
        expect(byColour(effects.unshieldedOutputs)).toEqual([[hex(backing), amount]]);
      }
    });

    it('pays it to the address it was asked to pay', async () => {
      const { result } = await wrap(500n);
      const to = sampleUserAddress();
      const effects = effectsOf(await redeem(result, backing, to));
      expect(
        [...effects.claimedUnshieldedSpends.entries()].map(([[token, who], amount]) => [
          token.raw,
          who.address,
          amount,
        ]),
      ).toEqual([[hex(backing), to, 500n]]);
    });

    it('destroys the whole note rather than part of it', async () => {
      const { result } = await wrap(1234n);
      const redeemed = await redeem(result);
      expect(destroyed(redeemed)).toEqual([1234n]);
      // Two outputs and no more: the coin reaching the contract, and the coin
      // reaching the burn key. A third would be change from a partial burn, and
      // change is value this contract paid out and did not destroy.
      expect(shieldedOf(redeemed).outputs).toHaveLength(2);
    });

    it('destroys exactly what it pays out', async () => {
      for (const amount of [1n, 1234n]) {
        const { result } = await wrap(amount);
        const redeemed = await redeem(result);
        expect(destroyed(redeemed)).toEqual([amount]);
        expect(byColour(effectsOf(redeemed).unshieldedOutputs)).toEqual([[hex(backing), amount]]);
      }
    });

    it('takes no backing in while paying backing out', async () => {
      const { result } = await wrap(1234n);
      expect(byColour(effectsOf(await redeem(result)).unshieldedInputs)).toEqual([]);
    });
  });
});
