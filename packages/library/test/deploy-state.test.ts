// SPDX-License-Identifier: Apache-2.0

/**
 * The one assembly of a contract's deploy state, run on the converter's own
 * compiled contract: exactly the circuits given keys, the authority given at
 * counter 0, and every refusal by name. RED WHEN: a threshold of nothing is
 * built, a key for no circuit is dropped silently, a constructor that makes
 * or spends coins is deployed, or the authority given is not the one built.
 */

import {
  sampleSigningKey,
  signatureVerifyingKey,
  type ConstructorContext,
  type ConstructorResult,
} from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import { Contract } from '../../../contracts/converter/managed/contract/index.js';
import { deployState, type Authority, type Constructible } from '../src/deploy-state.js';
import { OWNERLESS } from '../src/released-converter.js';
import { A_VERIFIER_KEY } from './verifier-key.js';

/** A second well-formed key, so each circuit's key can be told apart. */
const ANOTHER_KEY = Uint8Array.from(A_VERIFIER_KEY, (byte, index) =>
  index === 500 ? byte ^ 1 : byte,
);
const KEYS = { wrap: A_VERIFIER_KEY, redeem: ANOTHER_KEY };

const build = (
  overrides: {
    contract?: Constructible<undefined>;
    keys?: Record<string, Uint8Array>;
    authority?: Authority;
  } = {},
) =>
  deployState({
    contract: overrides.contract ?? new Contract({}),
    args: [],
    initialPrivateState: undefined,
    coinPublicKey: '00'.repeat(32),
    verifierKeys: overrides.keys ?? KEYS,
    authority: overrides.authority ?? OWNERLESS,
  });

/** The converter's constructor, with coins added to what it leaves. */
function constructorWithCoins(coins: 'made' | 'spent'): Constructible<undefined> {
  return {
    async initialState(
      context: ConstructorContext<undefined>,
    ): Promise<ConstructorResult<undefined>> {
      const result = await new Contract({}).initialState(context);
      const local = result.currentZswapLocalState;
      const coin = { nonce: new Uint8Array(32), color: new Uint8Array(32), value: 1n };
      return {
        ...result,
        currentZswapLocalState:
          coins === 'made'
            ? {
                ...local,
                outputs: [
                  {
                    coinInfo: coin,
                    recipient: {
                      is_left: true,
                      left: { bytes: new Uint8Array(32) },
                      right: { bytes: new Uint8Array(32) },
                    },
                  },
                ],
              }
            : { ...local, inputs: [{ ...coin, mt_index: 0n }] },
      };
    },
  };
}

describe('the deploy state of a contract', () => {
  it('holds every circuit given a key, with that key, and the constructor public data', async () => {
    const { state } = await build();
    expect(state.operations().map(String).sort()).toEqual(['redeem', 'wrap']);
    expect(Buffer.from(state.operation('wrap')?.verifierKey ?? [])).toEqual(
      Buffer.from(A_VERIFIER_KEY),
    );
    const constructed = await new Contract({}).initialState({
      initialPrivateState: undefined,
      initialZswapLocalState: {
        coinPublicKey: { bytes: new Uint8Array(32) },
        currentIndex: 0n,
        inputs: [],
        outputs: [],
      },
    });
    expect(state.data.state.encode()).toEqual(constructed.currentContractState.data.state.encode());
  });

  it('deploys only the circuits given keys, leaving out one the contract declares and is not given', async () => {
    const { state } = await build({ keys: { wrap: A_VERIFIER_KEY } });
    expect(state.operations().map(String)).toEqual(['wrap']);
  });

  it('is held by nobody when given no committee and one signature: the counter starts at 0', async () => {
    const authority = (await build()).state.maintenanceAuthority;
    expect([authority.committee.length, authority.threshold, authority.counter]).toEqual([
      0,
      1,
      0n,
    ]);
  });

  it('is held by exactly the keys and threshold given', async () => {
    const key = signatureVerifyingKey(sampleSigningKey());
    const authority = (await build({ authority: { committee: [key], threshold: 1 } })).state
      .maintenanceAuthority;
    expect([authority.committee, authority.threshold, authority.counter]).toEqual([[key], 1, 0n]);
  });

  it('refuses a threshold of nothing, which would let anyone change the contract', async () => {
    await expect(build({ authority: { committee: [], threshold: 0 } })).rejects.toThrow(
      /threshold of at least one signature; got 0/,
    );
  });

  it('refuses a threshold that is not a whole number of signatures', async () => {
    await expect(build({ authority: { committee: [], threshold: 1.5 } })).rejects.toThrow(
      /threshold of at least one signature; got 1.5/,
    );
  });

  it('refuses to deploy a contract with no circuit', async () => {
    await expect(build({ keys: {} })).rejects.toThrow(/at least one circuit, and no key was given/);
  });

  it('refuses a key for a circuit the contract does not declare', async () => {
    await expect(build({ keys: { ...KEYS, mint: A_VERIFIER_KEY } })).rejects.toThrow(
      /declares no circuit "mint"/,
    );
  });

  it('refuses a constructor that made a coin, which a deploy cannot carry', async () => {
    await expect(build({ contract: constructorWithCoins('made') })).rejects.toThrow(
      /constructor made or spent coins/,
    );
  });

  it('refuses a constructor that spent a coin', async () => {
    await expect(build({ contract: constructorWithCoins('spent') })).rejects.toThrow(
      /constructor made or spent coins/,
    );
  });

  it('refuses a threshold larger than the ledger can hold', async () => {
    await expect(build({ authority: { committee: [], threshold: 2 ** 32 } })).rejects.toThrow(
      /threshold of at least one signature; got 4294967296/,
    );
  });

  it('runs the constructor with the arguments and private state given, and returns the private state it left', async () => {
    const seen: unknown[] = [];
    const recording: Constructible<string> = {
      async initialState(context: ConstructorContext<string>, ...args: never[]) {
        seen.push(context.initialPrivateState, ...args);
        const built = await new Contract({}).initialState({
          ...context,
          initialPrivateState: undefined,
        });
        return { ...built, currentPrivateState: `${context.initialPrivateState} after` };
      },
    };
    const built = await deployState({
      contract: recording,
      args: [7n, 'eight'],
      initialPrivateState: 'before',
      coinPublicKey: '00'.repeat(32),
      verifierKeys: KEYS,
      authority: OWNERLESS,
    });
    expect(seen).toEqual(['before', 7n, 'eight']);
    expect(built.privateState).toBe('before after');
  });
});
