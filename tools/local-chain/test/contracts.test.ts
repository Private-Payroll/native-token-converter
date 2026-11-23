// SPDX-License-Identifier: Apache-2.0

/**
 * What the tool's readers of a deployed contract do when the indexer has no
 * contract at the address, checked against an indexer made here rather than a
 * chain. RED WHEN: a missing contract reads as a contract with no state, or as
 * one whose every pool is empty.
 */

import { describe, expect, it } from 'vitest';
import {
  contractBalances,
  contractState,
  deployedState,
  type ContractProviders,
} from '../src/contracts.js';

const ADDRESS = 'ab'.repeat(32);

/** Providers whose indexer has no contract anywhere. */
const nothingDeployed = {
  providers: {
    publicDataProvider: {
      queryContractState: () => Promise.resolve(null),
      queryUnshieldedBalances: () => Promise.resolve(null),
    },
  },
} as unknown as ContractProviders;

describe('reading a contract the indexer does not have', () => {
  it('refuses its state, naming the address', async () => {
    await expect(deployedState(nothingDeployed, ADDRESS)).rejects.toThrow(
      `the indexer has no contract at ${ADDRESS}`,
    );
    await expect(contractState(nothingDeployed, ADDRESS)).rejects.toThrow(
      `the indexer has no contract at ${ADDRESS}`,
    );
  });

  it('refuses its pools rather than report every one empty', async () => {
    await expect(contractBalances(nothingDeployed, ADDRESS)).rejects.toThrow(
      `the indexer has no contract at ${ADDRESS}`,
    );
  });
});
