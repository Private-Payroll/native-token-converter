// SPDX-License-Identifier: Apache-2.0

/**
 * Compiles the contract into contracts/managed.
 *
 * The pinned compiler is fetched if it is not already here, so a clone plus
 * Node is enough to build, and what gets built is what this repository was
 * written against. Which version that is, and where it comes from, is in
 * src/toolchain.ts.
 *
 * Proving keys are skipped unless --with-proving-keys is passed: they take
 * minutes and megabytes, and are needed only to deploy or to prove.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { COMPACTC_VERSION, releaseAsset, releaseUrl, wrongVersion } from '../src/toolchain.js';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'contracts', 'src', 'NativeTokenConverter.compact');
const OUTPUT = join(ROOT, 'contracts', 'managed');
/*
 * THE CACHE IS KEYED BY PLATFORM, AND THAT IS NOT TIDINESS.
 *
 * The compiler is a native executable. One unkeyed directory holds exactly one
 * of them, and `existsSync` then answers *a compiler is cached* when the honest
 * answer is *a compiler for some other machine is cached*. The failure is not a
 * missing file - it is `Exec format error`, several layers down, from a step
 * that has nothing to do with which machine downloaded what.
 *
 * It is reached whenever the same working tree is opened by more than one
 * machine, which is ordinary and not exotic.
 */
const CACHE = join(ROOT, '.compactc', `${platform()}-${arch()}`);

function fetchCompiler(): string {
  const asset = releaseAsset(platform(), arch());
  mkdirSync(CACHE, { recursive: true });
  const archive = join(CACHE, asset);
  console.log(`fetching Compact compiler ${COMPACTC_VERSION}`);
  execFileSync(
    'curl',
    ['--fail', '--location', '--silent', '--show-error', '--output', archive, releaseUrl(asset)],
    { stdio: 'inherit' },
  );
  execFileSync('unzip', ['-o', '-q', archive, '-d', CACHE], { stdio: 'inherit' });
  for (const entry of readdirSync(CACHE)) {
    if (!entry.endsWith('.zip')) {
      chmodSync(join(CACHE, entry), 0o755);
    }
  }
  return join(CACHE, 'compactc');
}

function compiler(): string {
  const supplied = process.env['COMPACTC'];
  if (supplied !== undefined && supplied !== '') {
    return supplied;
  }
  const cached = join(CACHE, 'compactc');
  return existsSync(cached) ? cached : fetchCompiler();
}

const compactc = compiler();
const found = execFileSync(compactc, ['--version'], { encoding: 'utf8' }).trim();
if (found !== COMPACTC_VERSION) {
  throw new Error(wrongVersion(found));
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
