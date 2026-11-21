// SPDX-License-Identifier: Apache-2.0

import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'test/**/*.test.ts',
      'contracts/*/test/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'tools/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
    ],
    // The local chain tests start Docker containers and prove transactions,
    // which takes minutes; they run on their own, from vitest.local-chain.config.ts.
    exclude: [...configDefaults.exclude, '**/*.chain.test.ts'],
  },
});
