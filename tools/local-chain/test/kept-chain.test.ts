// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { KEPT, keptChainRunning } from '../src/kept-chain.js';
import { runNames, type Service } from '../src/services.js';

const PINNED: Readonly<Record<Service, string>> = {
  node: `midnightntwrk/midnight-node:2.1.101@sha256:${'a'.repeat(64)}`,
  indexer: `midnightntwrk/indexer-standalone:4.4.101@sha256:${'b'.repeat(64)}`,
  'proof server': `midnightntwrk/proof-server:9.0.1@sha256:${'c'.repeat(64)}`,
};
const CONTAINERS = runNames(KEPT).containers;
const SERVICES = Object.keys(PINNED) as Service[];

/**
 * Docker as it answers on a machine where `running` containers are up, each
 * started from the reference `startedFrom` gives. Like Docker itself, `ps`
 * reports a pinned image by its tag alone; only `inspect` gives the digest.
 */
function dockerWith(
  running: readonly Service[],
  startedFrom: Readonly<Record<Service, string>> = PINNED,
): (args: readonly string[]) => string {
  return (args) => {
    if (args[0] === 'ps' && args.includes('{{.Names}}')) {
      return ['unrelated-container', ...running.map((s) => CONTAINERS[s])].join('\n');
    }
    if (args[0] === 'ps') {
      return running.map((s) => startedFrom[s].split('@')[0]).join('\n');
    }
    if (args[0] === 'inspect') {
      const service = SERVICES.find((s) => CONTAINERS[s] === args[args.length - 1]);
      if (service === undefined) {
        throw new Error(`no such container: ${String(args[args.length - 1])}`);
      }
      return startedFrom[service];
    }
    throw new Error(`unexpected docker ${args.join(' ')}`);
  };
}

describe('the kept local chain', () => {
  it('runs under names starting local-chain-kept, which the stop door tells a person to look for', () => {
    expect(runNames(KEPT).network).toBe('local-chain-kept');
    expect(Object.values(CONTAINERS)).toEqual([
      'local-chain-kept-node',
      'local-chain-kept-indexer',
      'local-chain-kept-proof-server',
    ]);
  });

  it('counts as running when all three run the pinned images, though docker ps shows only their tags', () => {
    expect(keptChainRunning(dockerWith(SERVICES), PINNED)).toBe(true);
  });

  it('does not count as running when any one of the three is missing', () => {
    for (const missing of SERVICES) {
      const others = SERVICES.filter((s) => s !== missing);
      expect(keptChainRunning(dockerWith(others), PINNED)).toBe(false);
    }
  });

  it('does not count as running when one runs an image other than the one pinned now', () => {
    const older = {
      ...PINNED,
      indexer: `midnightntwrk/indexer-standalone:4.4.100@sha256:${'d'.repeat(64)}`,
    };
    expect(keptChainRunning(dockerWith(SERVICES, older), PINNED)).toBe(false);
  });

  it('does not count as running when a container stops before its image is read', () => {
    const listed = dockerWith(SERVICES);
    const stoppedMeanwhile = (args: readonly string[]): string => {
      if (args[0] === 'inspect' && args[args.length - 1] === CONTAINERS.indexer) {
        throw new Error(`Error: No such object: ${CONTAINERS.indexer}`);
      }
      return listed(args);
    };
    expect(keptChainRunning(stoppedMeanwhile, PINNED)).toBe(false);
  });

  it('does not count as running when one runs the pinned tag under a different digest', () => {
    const other = {
      ...PINNED,
      node: `midnightntwrk/midnight-node:2.1.101@sha256:${'e'.repeat(64)}`,
    };
    expect(keptChainRunning(dockerWith(SERVICES, other), PINNED)).toBe(false);
  });
});
