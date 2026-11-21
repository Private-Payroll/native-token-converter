// SPDX-License-Identifier: Apache-2.0

/**
 * Finds the pinned Compact compiler, fetching it into this package's cache the
 * first time, and compiles any contract with it. COMPACTC, when set, names a
 * compiler to use instead. Every download is checked against its published
 * digest before it is unpacked, and a compiler of any other version is refused
 * before anything is built.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  COMPACTC_VERSION,
  digestProblem,
  releaseAsset,
  releaseUrl,
  reportedVersion,
  wrongVersion,
} from './toolchain.js';

const ROOT = resolve(import.meta.dirname, '..');
/*
 * THE CACHE IS KEYED BY VERSION AND BY PLATFORM, AND THAT IS NOT TIDINESS.
 *
 * The compiler is a native executable. One unkeyed directory holds exactly one
 * of them, and `existsSync` then answers *a compiler is cached* when the honest
 * answer is *a compiler for some other machine is cached*. The failure is not a
 * missing file - it is `Exec format error`, several layers down, from a step
 * that has nothing to do with which machine downloaded what. It is reached
 * whenever the same working tree is opened by more than one machine, which is
 * ordinary and not exotic.
 *
 * The version is in the key for the same reason. Without it, moving the pin
 * leaves the old compiler cached, and every build after the move stops on the
 * version check until somebody clears the cache by hand.
 */
const CACHE = join(ROOT, '.compactc', COMPACTC_VERSION, `${platform()}-${arch()}`);

/*
 * Everything is fetched and unpacked beside the cache and moved into place in
 * one rename at the end. A fetch stopped partway therefore leaves no cache at
 * all, never a half-unpacked one that every later build would trust because
 * the file it looks for happens to exist.
 */
function fetchCompiler(): string {
  const asset = releaseAsset(platform(), arch());
  const staging = `${CACHE}.partial`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const archive = join(staging, asset);
  console.log(`fetching Compact compiler ${COMPACTC_VERSION}`);
  execFileSync(
    'curl',
    ['--fail', '--location', '--silent', '--show-error', '--output', archive, releaseUrl(asset)],
    { stdio: 'inherit' },
  );
  const problem = digestProblem(
    asset,
    createHash('sha256').update(readFileSync(archive)).digest('hex'),
  );
  if (problem !== undefined) {
    throw new Error(problem);
  }
  execFileSync('unzip', ['-o', '-q', archive, '-d', staging], { stdio: 'inherit' });
  for (const entry of readdirSync(staging)) {
    if (!entry.endsWith('.zip')) {
      chmodSync(join(staging, entry), 0o755);
    }
  }
  rmSync(CACHE, { recursive: true, force: true });
  renameSync(staging, CACHE);
  return join(CACHE, 'compactc');
}

export function compiler(): string {
  const supplied = process.env['COMPACTC'];
  if (supplied !== undefined && supplied !== '') {
    return supplied;
  }
  const cached = join(CACHE, 'compactc');
  return existsSync(cached) ? cached : fetchCompiler();
}

/**
 * The pinned compiler: the one COMPACTC names, else the cached one, else one
 * fetched now. Throws before returning one of any other version.
 */
export function pinnedCompiler(): { readonly path: string; readonly version: string } {
  const path = compiler();
  const printed = execFileSync(path, ['--version'], { encoding: 'utf8' }).trim();
  const version = reportedVersion(printed);
  if (version !== COMPACTC_VERSION) {
    throw new Error(wrongVersion(printed));
  }
  return { path, version };
}

/** How a contract is compiled. */
export interface CompileOptions {
  /**
   * Whether to write proving keys. They take minutes and megabytes, and are
   * needed only to deploy or to prove.
   */
  readonly withProvingKeys: boolean;
}

/**
 * Compiles the contract at `source` into `outputDir`, replacing whatever was
 * there, and returns the compiler version that built it.
 */
export function compileContract(
  source: string,
  outputDir: string,
  options: CompileOptions,
): string {
  const compactc = pinnedCompiler();
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  execFileSync(
    compactc.path,
    [...(options.withProvingKeys ? [] : ['--skip-zk']), source, outputDir],
    {
      stdio: 'inherit',
      // zkir sits beside the compiler and is found on the path.
      env: { ...process.env, PATH: `${dirname(compactc.path)}:${process.env['PATH'] ?? ''}` },
    },
  );
  // The generated code is ESM and lands in a directory with no package.json of
  // its own, so Node has to be told what it is looking at.
  writeFileSync(
    join(outputDir, 'package.json'),
    `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
  );
  return compactc.version;
}
