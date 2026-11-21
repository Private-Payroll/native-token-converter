// SPDX-License-Identifier: Apache-2.0

/**
 * Compiles the contract into managed/, beside its source.
 *
 * Fetching and running the pinned compiler is the toolchain package's, which
 * any contract can be compiled with; this names the one this repository
 * publishes and where its build goes. A compiler that is not the pinned
 * version is refused before anything is built.
 *
 * Proving keys are skipped unless --with-proving-keys is passed: they take
 * minutes and megabytes, and are needed only to deploy or to prove.
 */

import { join, resolve } from 'node:path';
import { compileContract } from '@native-token-converter/toolchain/compiler';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'src', 'NativeTokenConverter.compact');
const OUTPUT = join(ROOT, 'managed');

const withProvingKeys = process.argv.includes('--with-proving-keys');
const found = compileContract(SOURCE, OUTPUT, { withProvingKeys });

console.log(
  `compiled with Compact ${found}${withProvingKeys ? ', with proving keys' : ', without proving keys'}`,
);
