// SPDX-License-Identifier: Apache-2.0

/**
 * Which Compact toolchain this repository is written against, and where to get
 * it. Kept apart from the script that runs it so the choice can be read, and
 * tested, without compiling anything.
 */

/**
 * The pinned compiler, and the only place its version is written. Each
 * compiler release emits code for one Compact runtime, so the exact runtime
 * dependency in package.json is the other half of this pin and the two move
 * together; the contract test reads both back out of the compiled output.
 *
 * A published release rather than a release candidate, because a stranger with
 * a clone has to be able to get the same compiler this was written against.
 */
export const COMPACTC_VERSION = '0.36.1';

/**
 * The version a compiler reports, read from what `--version` prints. Releases
 * from 0.36 on print the commit and date they were built from after the
 * version, so the version is the first word and nothing else.
 */
export function reportedVersion(printed: string): string {
  return printed.trim().split(/\s+/)[0] ?? '';
}

/** The release asset for a machine, named the way Node names it. */
export function releaseAsset(nodePlatform: string, nodeArch: string): string {
  const cpu = nodeArch === 'arm64' ? 'aarch64' : 'x86_64';
  if (nodePlatform === 'darwin') {
    return `compactc_v${COMPACTC_VERSION}_${cpu}-darwin.zip`;
  }
  if (nodePlatform === 'linux') {
    return `compactc_v${COMPACTC_VERSION}_${cpu}-unknown-linux-musl.zip`;
  }
  throw new Error(
    `there is no pinned Compact compiler for ${nodePlatform}/${nodeArch}; ` +
      'set COMPACTC to a compiler of the pinned version instead',
  );
}

/**
 * The SHA-256 of every release asset of the pinned compiler, as the release
 * publishes them. A fetched archive is checked against its entry before it is
 * unpacked, so what runs is the release itself and not whatever answered the
 * download. Keyed by the asset's full name, which carries the version: moving
 * the pin without these moves nothing, because no asset of the new version has
 * an entry.
 */
export const COMPACTC_SHA256: Readonly<Record<string, string>> = {
  'compactc_v0.36.1_aarch64-darwin.zip':
    '96ee68a59d9e8b093f05c97479a4cf08c79760015dcc26ecc797ec0160ca27f9',
  'compactc_v0.36.1_aarch64-unknown-linux-musl.zip':
    '7f07304d818d2bab6f96013277721238bbb96908ed8bf79273404d83a645c844',
  'compactc_v0.36.1_x86_64-darwin.zip':
    'c33ed75d228253c8f647960cc9082c94696cc1e81a741643fc4da233b222d564',
  'compactc_v0.36.1_x86_64-unknown-linux-musl.zip':
    '9d5fedfec9ae775a1e47d5c6f785130b314c1c5c52cd1a4eb9fc56d1fc61d23a',
};

/**
 * Why a fetched archive must not be unpacked, or undefined when its digest is
 * the one the release published. An asset with no published digest here is
 * refused rather than trusted.
 */
export function digestProblem(asset: string, actual: string): string | undefined {
  const expected = COMPACTC_SHA256[asset];
  if (expected === undefined) {
    return `there is no published digest for ${asset}; add the release's digest beside the pinned version`;
  }
  if (actual !== expected) {
    return (
      `${asset} does not match the digest its release published (expected ${expected}, found ${actual}). ` +
      'It was not unpacked. Fetch it again; if it still differs, do not use it.'
    );
  }
  return undefined;
}

/** Where that asset is published. */
export function releaseUrl(asset: string): string {
  return `https://github.com/midnightntwrk/compact/releases/download/compactc-v${COMPACTC_VERSION}/${asset}`;
}

/**
 * The refusal a wrong compiler earns. A different compiler produces a contract
 * that a different runtime expects, and nothing says so until a deploy.
 */
export function wrongVersion(found: string): string {
  return (
    `this repository is written against Compact compiler ${COMPACTC_VERSION} and found ${found}. ` +
    'A contract built with another compiler expects another runtime, and nothing says so until it is deployed. ' +
    'Delete the fetched compiler and build again, or point COMPACTC at one of the pinned version.'
  );
}
