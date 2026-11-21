// SPDX-License-Identifier: Apache-2.0

/**
 * The rule for whether the kept local chain is already up: every one of its
 * containers is running, each from the image pinned for it now. Docker is
 * reached through the function handed in, so the rule can be read against
 * Docker's own output without starting anything.
 */

import { runNames, type Service } from './services.js';

/** The name the kept chain's containers and network carry. */
export const KEPT = 'kept';

/** Runs one Docker command and returns what it printed, trimmed. */
export type DockerRunner = (args: readonly string[]) => string;

/**
 * Whether every container of the kept chain is running the image pinned for
 * it now. One running an older pin counts as not running, so a start after
 * the pins move replaces it rather than leaving the old ledger up.
 */
export function keptChainRunning(
  docker: DockerRunner,
  images: Readonly<Record<Service, string>>,
): boolean {
  const running = new Set(docker(['ps', '--format', '{{.Names}}']).split('\n'));
  const containers = runNames(KEPT).containers;
  return (Object.keys(images) as Service[]).every((service) => {
    if (!running.has(containers[service])) {
      return false;
    }
    // `docker ps` shows a pinned image by its tag alone, so the reference the
    // container was started from, digest included, is read from its own
    // configuration instead.
    // A container that stops between the two commands is not running.
    try {
      const started = docker(['inspect', '--format', '{{.Config.Image}}', containers[service]]);
      return started === images[service];
    } catch {
      return false;
    }
  });
}
