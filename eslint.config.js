// SPDX-License-Identifier: Apache-2.0

/**
 * One lint configuration for every workspace: typescript-eslint's strict rules,
 * with type information, over every TypeScript file the repository holds. The
 * files .gitignore names are generated, so they are left out by reading that
 * file rather than by listing them a second time here.
 */

import { fileURLToPath } from 'node:url';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  includeIgnoreFile(fileURLToPath(new URL('.gitignore', import.meta.url))),
  {
    files: ['**/*.{ts,mts,cts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
);
