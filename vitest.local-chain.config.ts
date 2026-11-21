// SPDX-License-Identifier: Apache-2.0

/**
 * The tests that deploy and call contracts on a local chain. They start or
 * reuse a node, an indexer and a proof server, and prove real transactions,
 * so one file runs at a time and each step is given minutes rather than
 * seconds. The default configuration leaves these files out.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['contracts/*/test/local-chain/**/*.chain.test.ts'],
    fileParallelism: false,
    testTimeout: 20 * 60_000,
    hookTimeout: 20 * 60_000,
  },
});
