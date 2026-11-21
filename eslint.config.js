// SPDX-License-Identifier: Apache-2.0

/**
 * One lint configuration for every workspace: typescript-eslint's strict rules,
 * with type information, over every TypeScript file the repository holds. The
 * files .gitignore names are generated, so they are left out by reading that
 * file rather than by listing them a second time here.
 *
 * The local chain tests read their types from builds with keys, which a fresh
 * clone does not have, so they are linted only when LOCAL_CHAIN_LINT is 1,
 * against tsconfig.local-chain.json, by `npm run test:local-chain` once it has
 * compiled them.
 */

import { fileURLToPath } from 'node:url';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const CHAIN_TESTS = 'contracts/*/test/local-chain/**';
const chainTests =
  process.env['LOCAL_CHAIN_LINT'] === '1'
    ? {
        files: [CHAIN_TESTS],
        languageOptions: {
          parserOptions: { projectService: false, project: './tsconfig.local-chain.json' },
        },
      }
    : { ignores: [CHAIN_TESTS] };

export default defineConfig(
  includeIgnoreFile(fileURLToPath(new URL('.gitignore', import.meta.url))),
  {
    files: ['**/*.{ts,mts,cts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  chainTests,
);
