// SPDX-License-Identifier: Apache-2.0

/**
 * Compiles the contract into managed/, beside its source.
 *
 * Fetching and running the pinned compiler is the toolchain package's, which
 * any contract can be compiled with; this names the one this repository
 * publishes and where its build goes. A compiler that is not the pinned
 * version is refused before anything is built.
 *
 * This build has no proving or verifier keys, which take minutes and are
 * needed only to deploy or to prove: `npm run compile:keys` builds every
 * contract with its keys, into its own folder.
 */

import { join, resolve } from 'node:path';
import { compileContract } from '@native-token-converter/toolchain/compiler';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'src', 'NativeTokenConverter.compact');
const OUTPUT = join(ROOT, 'managed');

const found = compileContract(SOURCE, OUTPUT, { withProvingKeys: false });

console.log(`compiled with Compact ${found}, without proving keys`);
