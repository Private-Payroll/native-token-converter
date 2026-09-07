// SPDX-License-Identifier: Apache-2.0

/**
 * Which Compact toolchain this repository is written against, and where to get
 * it. Kept apart from the script that runs it so the choice can be read, and
 * tested, without compiling anything.
 */

/**
 * The pinned compiler. It carries language version 0.26.0 and expects Compact
 * runtime 0.19.0 and a ledger 9 chain; the dependency on the runtime in
 * package.json is the other half of this pin and the two move together.
 *
 * A published release rather than a release candidate, because a stranger with
 * a clone has to be able to get the same compiler this was written against.
 */
export const COMPACTC_VERSION = '0.34.0';

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
