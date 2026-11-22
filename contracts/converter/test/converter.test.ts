// SPDX-License-Identifier: Apache-2.0

/**
 * The contract, run.
 *
 * These go through the compiled circuits and read the ledger effects they
 * produce, so what is checked is what the chain would be asked to do: which
 * colour came in, which colour went out, how much of each, and to whom. Each
 * refusal is checked by its own message, so a test passes only when the check
 * it names is the one that refused.
 */

import {
  createCircuitContext,
  encodeCoinPublicKey,
  encodeContractAddress,
  encodeRawTokenType,
  encodeUserAddress,
  hasCoinCommitment,
  sampleContractAddress,
  sampleRawTokenType,
  sampleUserAddress,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { Contract } from '../managed/contract/index.js';
import { isWrappedNoteOf, wrappedColour } from '../../../packages/library/src/wrapped-colour.js';

interface Coin {
  readonly nonce: Uint8Array;
  readonly color: Uint8Array;
  readonly value: bigint;
}

/** Either side of a recipient, as the compiled contract takes and reports it. */
interface Recipient {
  readonly is_left: boolean;
  readonly left: { readonly bytes: Uint8Array };
  readonly right: { readonly bytes: Uint8Array };
}

/** A shielded output a circuit created: a coin, and who it went to. */
interface ShieldedOutput {
  readonly coinInfo: Coin;
  readonly recipient: Recipient;
}

/** The shielded coins a circuit took in and put out. */
interface ZswapState {
  readonly inputs: readonly Coin[];
  readonly outputs: readonly ShieldedOutput[];
}

/** The ledger bookkeeping a circuit asks for, as the runtime reports it. */
interface Effects {
  readonly claimedNullifiers: readonly string[];
  readonly claimedShieldedReceives: readonly string[];
  readonly claimedShieldedSpends: readonly string[];
  readonly shieldedMints: Map<string, bigint>;
  readonly unshieldedInputs: Map<{ raw: string }, bigint>;
  readonly unshieldedOutputs: Map<{ raw: string }, bigint>;
  readonly claimedUnshieldedSpends: Map<
    [{ raw: string }, { tag: string; address: string }],
    bigint
  >;
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const someColour = (): Uint8Array => encodeRawTokenType(sampleRawTokenType());

/** Thirty-two zero bytes: a key or an address nobody holds and nobody can spend from. */
const ZERO = new Uint8Array(32);

/** Thirty-two bytes that are nobody's in particular, for the branch a recipient does not take. */
const STRAY = new Uint8Array(32).fill(7);

const toKey = (bytes: Uint8Array, notTaken = ZERO): Recipient => ({
  is_left: true,
  left: { bytes },
  right: { bytes: notTaken },
});
const toContract = (address: string, notTaken = ZERO): Recipient => ({
  is_left: false,
  left: { bytes: notTaken },
  right: { bytes: encodeContractAddress(address) },
});
const payContract = (address: string, notTaken = ZERO): Recipient => ({
  is_left: true,
  left: { bytes: encodeContractAddress(address) },
  right: { bytes: notTaken },
});
const payUser = (address: string, notTaken = ZERO): Recipient => ({
  is_left: false,
  left: { bytes: notTaken },
  right: { bytes: encodeUserAddress(address) },
});
const paidOut = (effects: Effects): Array<[string, string, string, bigint]> =>
  [...effects.claimedUnshieldedSpends.entries()].map(([[token, who], amount]) => [
    token.raw,
    who.tag,
    who.address,
    amount,
  ]);
const aKey = (): Recipient => toKey(encodeCoinPublicKey(sampleContractAddress()));

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
    const built = await contract.initialState({
      initialZswapLocalState: { coinPublicKey: sampleContractAddress() },
      initialPrivateState: {},
    } as never);
    state = built.currentContractState.data;
  });

  const context = (circuit: string, at: string = converterAddress): never =>
    createCircuitContext({
      circuitId: circuit,
      contractAddress: at,
      coinPublicKeyOrZswapState: sampleContractAddress(),
      contractState: state as never,
      privateState: {},
    }) as never;

  const effectsOf = (result: { context: unknown }): Effects =>
    (result.context as { callContext: { currentQueryContext: { effects: Effects } } }).callContext
      .currentQueryContext.effects;

  const shieldedOf = (result: { context: unknown }): ZswapState =>
    (result.context as { callContext: { currentZswapLocalState: ZswapState } }).callContext
      .currentZswapLocalState;

  // A fresh nonce per call. The caller owes uniqueness per pool, and a test
  // that reuses one is modelling the mistake rather than the practice.
  let nonces = 0;
  const freshNonce = (): Uint8Array => {
    nonces += 1;
    const nonce = new Uint8Array(32);
    new DataView(nonce.buffer).setUint32(0, nonces);
    return nonce;
  };

  const wrap = async (amount: bigint, to: Recipient = aKey(), colour: Uint8Array = backing) =>
    contract.impureCircuits.wrap(context('wrap'), colour, amount, to, freshNonce());

  const redeem = async (
    coin: Coin,
    to: Recipient = payUser(sampleUserAddress()),
    colour: Uint8Array = backing,
    at: string = converterAddress,
  ) => contract.impureCircuits.redeem(context('redeem', at), colour, coin, to);

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

    it("mints a note a client then recognises as this pool's", async () => {
      const { result } = await wrap(1234n);
      expect(isWrappedNoteOf(result.color, backing, converterAddress)).toBe(true);
      expect(isWrappedNoteOf(result.color, someColour(), converterAddress)).toBe(false);
    });

    it('mints to the key it was given', async () => {
      const to = aKey();
      const outputs = shieldedOf(await wrap(1234n, to)).outputs;
      expect(
        outputs.map((each) => [each.recipient.is_left, hex(each.recipient.left.bytes)]),
      ).toEqual([[true, hex(to.left.bytes)]]);
    });

    it('mints to a contract it was given, so a contract can wrap for itself', async () => {
      const holder = sampleContractAddress();
      const outputs = shieldedOf(await wrap(1234n, toContract(holder))).outputs;
      expect(
        outputs.map((each) => [each.recipient.is_left, hex(each.recipient.right.bytes)]),
      ).toEqual([[false, holder]]);
    });

    it('mints the coin with the nonce it was given, which keeps each coin distinct', async () => {
      const nonce = new Uint8Array(32).fill(9);
      const wrapped = await contract.impureCircuits.wrap(
        context('wrap'),
        backing,
        1234n,
        aKey(),
        nonce,
      );
      expect(hex(wrapped.result.nonce)).toBe(hex(nonce));
      expect(shieldedOf(wrapped).outputs.map((each) => hex(each.coinInfo.nonce))).toEqual([
        hex(nonce),
      ]);
    });

    it('refuses an amount of zero', async () => {
      await expect(wrap(0n)).rejects.toThrow(/the amount to wrap is zero/);
    });

    it('refuses to mint to the zero key, which nobody could spend', async () => {
      await expect(wrap(1n, toKey(ZERO))).rejects.toThrow(/zero key or the zero address/);
    });

    it('refuses to mint to the zero contract address', async () => {
      await expect(wrap(1n, toContract('00'.repeat(32)))).rejects.toThrow(
        /zero key or the zero address/,
      );
    });

    it('refuses the zero key even when the branch not taken carries bytes', async () => {
      await expect(wrap(1n, toKey(ZERO, STRAY))).rejects.toThrow(/zero key or the zero address/);
    });

    it('refuses the zero contract address even when the branch not taken carries bytes', async () => {
      await expect(wrap(1n, toContract('00'.repeat(32), STRAY))).rejects.toThrow(
        /zero key or the zero address/,
      );
    });

    it('refuses to mint to this converter, which could never spend the coin', async () => {
      await expect(wrap(1n, toContract(converterAddress))).rejects.toThrow(
        /the recipient is this contract/,
      );
    });

    it('refuses this converter as recipient when the branch not taken carries bytes', async () => {
      await expect(wrap(1n, toContract(converterAddress, STRAY))).rejects.toThrow(
        /the recipient is this contract/,
      );
    });

    it('cannot be asked for more than the protocol can mint', async () => {
      await expect(wrap(2n ** 64n)).rejects.toThrow(
        /expected value of type Uint<0\.\.18446744073709551616>/,
      );
    });

    it('pays nothing out', async () => {
      expect(byColour(effectsOf(await wrap(1234n)).unshieldedOutputs)).toEqual([]);
    });

    it('brings a different pool into existence for a different backing colour', async () => {
      const other = someColour();
      const mine = await wrap(1n);
      const theirs = await wrap(1n, aKey(), other);
      expect(hex(mine.result.color)).not.toBe(hex(theirs.result.color));
      expect(hex(theirs.result.color)).toBe(hex(wrappedColour(other, converterAddress)));
    });
  });

  describe('redeeming', () => {
    it("refuses a coin that is not this converter's note for that backing colour", async () => {
      const stranger: Coin = { nonce: new Uint8Array(32), color: someColour(), value: 10n };
      await expect(redeem(stranger)).rejects.toThrow(/not of this contract's colour/);
    });

    it("refuses the converter's own note against a different backing colour", async () => {
      const { result } = await wrap(10n);
      await expect(redeem(result, undefined, someColour())).rejects.toThrow(
        /not of this contract's colour/,
      );
    });

    it('refuses a note of the same backing colour from another converter', async () => {
      const { result } = await wrap(10n);
      await expect(redeem(result, undefined, backing, sampleContractAddress())).rejects.toThrow(
        /not of this contract's colour/,
      );
    });

    it('refuses a coin worth nothing', async () => {
      const empty: Coin = {
        nonce: freshNonce(),
        color: wrappedColour(backing, converterAddress),
        value: 0n,
      };
      await expect(redeem(empty)).rejects.toThrow(/the coin is worth nothing/);
    });

    it('refuses to pay out to the zero user address, which nobody could spend from', async () => {
      const { result } = await wrap(1234n);
      await expect(redeem(result, payUser('00'.repeat(32)))).rejects.toThrow(
        /the payout address is the zero address/,
      );
    });

    it('refuses to pay out to the zero contract address', async () => {
      const { result } = await wrap(1234n);
      await expect(redeem(result, payContract('00'.repeat(32)))).rejects.toThrow(
        /the payout address is the zero address/,
      );
    });

    it('refuses the zero user address even when the branch not taken carries bytes', async () => {
      const { result } = await wrap(1234n);
      await expect(redeem(result, payUser('00'.repeat(32), STRAY))).rejects.toThrow(
        /the payout address is the zero address/,
      );
    });

    it('refuses the zero contract payee even when the branch not taken carries bytes', async () => {
      const { result } = await wrap(1234n);
      await expect(redeem(result, payContract('00'.repeat(32), STRAY))).rejects.toThrow(
        /the payout address is the zero address/,
      );
    });

    it('refuses to pay out to this converter, which would keep the payout in the pool', async () => {
      const { result } = await wrap(1234n);
      await expect(redeem(result, payContract(converterAddress))).rejects.toThrow(
        /the payout address is this contract/,
      );
    });

    it('refuses this converter as payee when the branch not taken carries bytes', async () => {
      const { result } = await wrap(1234n);
      await expect(redeem(result, payContract(converterAddress, STRAY))).rejects.toThrow(
        /the payout address is this contract/,
      );
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

    it('pays the user address it was asked to pay', async () => {
      const { result } = await wrap(500n);
      const to = sampleUserAddress();
      const effects = effectsOf(await redeem(result, payUser(to)));
      expect(paidOut(effects)).toEqual([[hex(backing), 'user', to, 500n]]);
    });

    it('pays a contract it was asked to pay, so a contract can redeem for itself', async () => {
      const { result } = await wrap(500n);
      const holder = sampleContractAddress();
      const effects = effectsOf(await redeem(result, payContract(holder)));
      expect(paidOut(effects)).toEqual([[hex(backing), 'contract', holder, 500n]]);
    });

    it('takes the coin in whole, as a coin this converter holds', async () => {
      const { result } = await wrap(1234n);
      const redeemed = await redeem(result);
      expect(
        shieldedOf(redeemed).outputs.map((output) => [
          output.recipient.is_left,
          hex(output.recipient.right.bytes),
          hex(output.coinInfo.nonce),
          hex(output.coinInfo.color),
          output.coinInfo.value,
        ]),
      ).toEqual([[false, converterAddress, hex(result.nonce), hex(result.color), 1234n]]);
      // The one receive it claims is that coin's commitment to this converter,
      // which the ledger matches against the coin the caller put in.
      const claimed = effectsOf(redeemed).claimedShieldedReceives;
      expect(claimed).toHaveLength(1);
      expect(
        hasCoinCommitment(redeemed.context as never, result, toContract(converterAddress)),
      ).toBe(true);
      expect(claimed).toEqual([
        ...(
          redeemed.context as {
            callContext: { currentQueryContext: { comIndices: Map<string, bigint> } };
          }
        ).callContext.currentQueryContext.comIndices.keys(),
      ]);
    });

    it('keeps the redeemed note: neither circuit spends a coin when it runs', async () => {
      // When run, neither circuit takes a shielded coin in or claims a nullifier,
      // so a note this converter holds does not move and its backing is paid once.
      // That no path of any circuit can spend one is read from the compiled
      // circuits, in the contract's own tests.
      const wrapped = await wrap(1234n);
      const redeemed = await redeem(wrapped.result);
      for (const call of [wrapped, redeemed]) {
        expect(shieldedOf(call).inputs).toEqual([]);
        expect(effectsOf(call).claimedNullifiers).toEqual([]);
      }
      // Nor does redeeming create a coin of its own: nothing is sent on.
      expect(effectsOf(redeemed).claimedShieldedSpends).toEqual([]);
      expect(effectsOf(redeemed).shieldedMints.size).toBe(0);
    });

    it('takes no backing in while paying backing out', async () => {
      const { result } = await wrap(1234n);
      expect(byColour(effectsOf(await redeem(result)).unshieldedInputs)).toEqual([]);
    });
  });
});
