// SPDX-License-Identifier: Apache-2.0

/**
 * Compiles the contract into managed/, beside its source.
 *
 * The pinned compiler is fetched if it is not already here, so a clone plus
 * Node is enough to build, and what gets built is what this repository was
 * written against. Which version that is, where it comes from and the digest
 * every download must match before it is unpacked are in the toolchain package.
 *
 * Proving keys are skipped unless --with-proving-keys is passed: they take
 * minutes and megabytes, and are needed only to deploy or to prove.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { COMPACTC_VERSION, reportedVersion, wrongVersion } from '@native-token-converter/toolchain';
import { compiler } from '@native-token-converter/toolchain/compiler';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'src', 'NativeTokenConverter.compact');
const OUTPUT = join(ROOT, 'managed');
const compactc = compiler();
const printed = execFileSync(compactc, ['--version'], { encoding: 'utf8' }).trim();
const found = reportedVersion(printed);
if (found !== COMPACTC_VERSION) {
  throw new Error(wrongVersion(printed));
}

const withProvingKeys = process.argv.includes('--with-proving-keys');
rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(OUTPUT, { recursive: true });
execFileSync(compactc, [...(withProvingKeys ? [] : ['--skip-zk']), SOURCE, OUTPUT], {
  stdio: 'inherit',
  // zkir sits beside the compiler and is found on the path.
  env: { ...process.env, PATH: `${dirname(compactc)}:${process.env['PATH'] ?? ''}` },
});

// The generated code is ESM and lands in a directory with no package.json of
// its own, so Node has to be told what it is looking at.
writeFileSync(join(OUTPUT, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);

console.log(
  `compiled with Compact ${found}${withProvingKeys ? ', with proving keys' : ', without proving keys'}`,
);
