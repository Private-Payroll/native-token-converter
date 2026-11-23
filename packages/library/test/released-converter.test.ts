// SPDX-License-Identifier: Apache-2.0

/**
 * The check a client makes that a contract is the converter this release of
 * the library names, against states built with the converter's own compiled
 * contract and releases made for the test. RED WHEN: a contract whose
 * committee holds a key, whose threshold no signature is needed for, or that
 * has been changed since it was deployed passes; a contract with a circuit
 * added or removed, another verifier key or other public data passes; or the
 * address is taken from anywhere but the release.
 */

import {
  ChargedState,
  ContractMaintenanceAuthority,
  ContractOperation,
  ContractState,
  StateValue,
  sampleSigningKey,
  signatureVerifyingKey,
} from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import { Contract } from '../../../contracts/converter/managed/contract/index.js';
import {
  OWNERLESS,
  RELEASED_CONVERTERS,
  checkAgainst,
  checkConverter,
  converterDeployState,
  deployStateDigest,
  problemsAgainst,
  type ReleasedConverter,
} from '../src/released-converter.js';
import { A_VERIFIER_KEY } from './verifier-key.js';

const ADDRESS = 'ab'.repeat(32);
const KEYS = { wrap: A_VERIFIER_KEY, redeem: A_VERIFIER_KEY };

/** The converter's deploy state built with the test's keys, and a release naming it. */
async function released(): Promise<{ state: ContractState; release: ReleasedConverter }> {
  const state = await converterDeployState(new Contract({}), KEYS);
  return {
    state,
    release: { deployState: await deployStateDigest(state), addresses: { preprod: ADDRESS } },
  };
}

/** `state` as the chain would hold it, changed by `change`. */
function changed(state: ContractState, change: (copy: ContractState) => void): Uint8Array {
  const copy = ContractState.deserialize(state.serialize());
  change(copy);
  return copy.serialize();
}

const withAuthority =
  (committee: number, threshold: number, counter: bigint) => (copy: ContractState) => {
    const keys = Array.from({ length: committee }, () => signatureVerifyingKey(sampleSigningKey()));
    copy.maintenanceAuthority = new ContractMaintenanceAuthority(keys, threshold, counter);
  };

describe('the converter a release names', () => {
  it('is held by nobody: no committee, and one signature needed', () => {
    expect(OWNERLESS).toEqual({ committee: [], threshold: 1 });
  });

  it('names one converter, by the digest of its deploy state, and no address yet', () => {
    expect(
      RELEASED_CONVERTERS.map((each) => [/^[0-9a-f]{64}$/.test(each.deployState), each.addresses]),
    ).toEqual([[true, {}]]);
  });
});

describe('whether a contract is the converter a release names', () => {
  it('finds nothing wrong with the converter as it was deployed', async () => {
    const { state, release } = await released();
    expect(await problemsAgainst(state.serialize(), release.deployState)).toEqual([]);
  });

  it('finds nothing wrong once its pools hold tokens, which change with every wrap and redeem', async () => {
    const { state, release } = await released();
    const withPool = changed(state, (copy) => {
      copy.balance = new Map([[{ tag: 'unshielded', raw: '01'.repeat(32) }, 5n]]);
    });
    expect(await problemsAgainst(withPool, release.deployState)).toEqual([]);
  });

  it('refuses a contract whose committee holds a key, which can replace its circuits', async () => {
    const { state, release } = await released();
    const problems = await problemsAgainst(
      changed(state, withAuthority(1, 1, 0n)),
      release.deployState,
    );
    expect(problems).toEqual([
      expect.stringMatching(/authority names 1 key\(s\)/),
      expect.stringMatching(/differ from the release/),
    ]);
  });

  it('refuses a contract whose threshold no signature is needed for, which anyone can change', async () => {
    const { state, release } = await released();
    const problems = await problemsAgainst(
      changed(state, withAuthority(0, 0, 0n)),
      release.deployState,
    );
    expect(problems).toEqual([
      expect.stringMatching(/threshold is 0, met with no signature at all/),
      expect.stringMatching(/differ from the release/),
    ]);
  });

  it('refuses a contract that has been changed since it was deployed', async () => {
    const { state, release } = await released();
    const problems = await problemsAgainst(
      changed(state, withAuthority(0, 1, 1n)),
      release.deployState,
    );
    expect(problems).toEqual([
      expect.stringMatching(/counter is 1, so it has been changed/),
      expect.stringMatching(/differ from the release/),
    ]);
  });

  it('refuses a contract with a circuit added', async () => {
    const { state, release } = await released();
    const added = changed(state, (copy) => {
      const operation = new ContractOperation();
      operation.verifierKey = A_VERIFIER_KEY;
      copy.setOperation('payOut', operation);
    });
    expect(await problemsAgainst(added, release.deployState)).toEqual([
      expect.stringMatching(/differ from the release: digest [0-9a-f]{64}/),
    ]);
  });

  it('refuses a contract with a circuit missing', async () => {
    const { release } = await released();
    const fewer = await converterDeployState(new Contract({}), { wrap: A_VERIFIER_KEY });
    expect(await problemsAgainst(fewer.serialize(), release.deployState)).toEqual([
      expect.stringMatching(/differ from the release/),
    ]);
  });

  it('refuses a contract whose circuit has another verifier key', async () => {
    const { release } = await released();
    const other = new Uint8Array(A_VERIFIER_KEY);
    other[500] = (other[500] ?? 0) ^ 1;
    const rekeyed = await converterDeployState(new Contract({}), { ...KEYS, redeem: other });
    expect(await problemsAgainst(rekeyed.serialize(), release.deployState)).toEqual([
      expect.stringMatching(/differ from the release/),
    ]);
  });

  it('refuses a contract with other public data', async () => {
    const { state, release } = await released();
    const other = changed(state, (copy) => {
      copy.data = new ChargedState(StateValue.newArray().arrayPush(StateValue.newNull()));
    });
    expect(await problemsAgainst(other, release.deployState)).toEqual([
      expect.stringMatching(/differ from the release/),
    ]);
  });

  it('refuses bytes that are not a contract state', async () => {
    const { release } = await released();
    expect(await problemsAgainst(new Uint8Array([1, 2, 3]), release.deployState)).toEqual([
      expect.stringMatching(/not a contract's state/),
    ]);
  });
});

describe('checking the converter on a network', () => {
  it('returns the address the release names once the contract there is the converter', async () => {
    const { state, release } = await released();
    const asked: string[] = [];
    const read = (address: string) => {
      asked.push(address);
      return Promise.resolve(state.serialize());
    };
    expect(await checkAgainst('preprod', read, [release])).toBe(ADDRESS);
    expect(asked).toEqual([ADDRESS]);
  });

  it('checks the newest converter the release names on that network', async () => {
    const { state, release } = await released();
    const older: ReleasedConverter = {
      deployState: '00'.repeat(32),
      addresses: { preprod: 'cd'.repeat(32) },
    };
    const read = () => Promise.resolve(state.serialize());
    expect(await checkAgainst('preprod', read, [older, release])).toBe(ADDRESS);
  });

  it('checks an older converter when the newest names no address on that network yet', async () => {
    const { state, release } = await released();
    const newer: ReleasedConverter = { deployState: '00'.repeat(32), addresses: {} };
    expect(
      await checkAgainst('preprod', () => Promise.resolve(state.serialize()), [release, newer]),
    ).toBe(ADDRESS);
  });

  it('refuses when the release names no converter at all', async () => {
    await expect(checkAgainst('preprod', () => Promise.resolve(undefined), [])).rejects.toThrow(
      /names no converter on the network "preprod"/,
    );
  });

  it('refuses a network named like a property every object has', async () => {
    const { state, release } = await released();
    for (const networkId of ['constructor', 'toString', '__proto__']) {
      await expect(
        checkAgainst(networkId, () => Promise.resolve(state.serialize()), [release]),
      ).rejects.toThrow(/names no converter on the network/);
    }
  });

  it('refuses a network the release names no converter on', async () => {
    const { state, release } = await released();
    await expect(
      checkAgainst('mainnet', () => Promise.resolve(state.serialize()), [release]),
    ).rejects.toThrow(/names no converter on the network "mainnet"/);
  });

  it('refuses when there is no contract at the address', async () => {
    const { release } = await released();
    await expect(
      checkAgainst('preprod', () => Promise.resolve(undefined), [release]),
    ).rejects.toThrow(/no contract at the converter's address/);
  });

  it('refuses, naming every problem, a contract at the address that is not the converter', async () => {
    const { state, release } = await released();
    const held = changed(state, withAuthority(1, 1, 0n));
    await expect(checkAgainst('preprod', () => Promise.resolve(held), [release])).rejects.toThrow(
      /is not the converter this library was released for: its authority names 1 key\(s\).*differ from the release/,
    );
  });

  it('names no converter on any network in this release, until one is deployed', async () => {
    await expect(checkConverter('preprod', () => Promise.resolve(undefined))).rejects.toThrow(
      /names no converter on the network "preprod"/,
    );
  });
});
