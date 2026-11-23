// SPDX-License-Identifier: Apache-2.0

/**
 * Starts a local chain that stays up, or stops it: `start` runs the pinned
 * node, indexer and proof server on their standard ports, so a browser wallet
 * or a test pointed at them by the LOCAL_CHAIN_* variables finds them at the
 * same addresses every time; `stop` removes exactly what `start` made. It
 * refuses when Docker cannot be reached, saying how to make it reachable;
 * `check` does only that, before anything slow that needs Docker later, and
 * says what the first run downloads and whether Docker has the memory to
 * prove.
 *
 *   npm run local-chain:start, or npm run local-chain:stop
 */

import { arch, platform } from 'node:os';
import {
  beforeTheChainStarts,
  docker,
  dockerMemory,
  dockerProblem,
  ENDPOINT_VARIABLES,
  environmentConfiguration,
  removeLocalChain,
  SERVICE_IMAGES,
  standardEndpoints,
  startLocalChain,
  type Endpoints,
  type Service,
} from './services.js';
import { KEPT, keptChainRunning } from './kept-chain.js';

/**
 * Prints the addresses a wallet is given, then the variables a test is given.
 * A wallet asks for the indexer's GraphQL and web socket addresses and the
 * network id, not the base addresses a test takes.
 */
function printEndpoints(endpoints: Endpoints): void {
  const wallet = environmentConfiguration(endpoints);
  console.log(`  network id        ${wallet.networkId}`);
  console.log(`  node              ${wallet.nodeWS}`);
  console.log(`  indexer           ${wallet.indexer}`);
  console.log(`  indexer web socket ${wallet.indexerWS}`);
  console.log(`  proof server      ${wallet.proofServer}`);
  console.log('For a test on this machine:');
  for (const [service, endpoint] of Object.entries(endpoints) as [Service, string][]) {
    console.log(`  ${ENDPOINT_VARIABLES[service]}=${endpoint}`);
  }
  console.log(
    'It keeps running until it is stopped. Stopping it throws the chain away: a wallet that synced',
  );
  console.log(
    'with it must have its sync state reset before it is pointed at a chain started again.',
  );
}

async function start(): Promise<void> {
  if (keptChainRunning(docker, SERVICE_IMAGES)) {
    // Starting again would throw away everything deployed on it, so a chain
    // already up is left as it is.
    console.log('The local chain was already running, and is left as it was:');
    printEndpoints(standardEndpoints());
    return;
  }
  // Whatever is left of a kept chain that stopped half way is cleared first,
  // so the names and ports are free.
  removeLocalChain(KEPT);
  const chain = await startLocalChain({ keptAs: KEPT });
  const given = (Object.keys(SERVICE_IMAGES) as Service[]).filter(
    (service) => !chain.started.includes(service),
  );
  if (given.length > 0) {
    // A LOCAL_CHAIN_* variable set in this shell names a service already
    // running somewhere; it is used rather than started, and said so.
    console.log(`Not started, because a variable names one already running: ${given.join(', ')}.`);
  }
  console.log('The local chain is running:');
  printEndpoints(chain.endpoints);
}

function stop(): void {
  const removed = removeLocalChain(KEPT);
  console.log(
    removed.length === 0
      ? 'No local chain was running.'
      : `Stopped and removed: ${removed.join(', ')}.`,
  );
}

const command = process.argv[2];
// The machine is printed first, so a report shows which images ran where.
console.log(`on ${platform()} ${arch()}`);
const problem = dockerProblem();
if (problem !== undefined) {
  console.log(problem);
  process.exit(1);
}
try {
  if (command === 'check') {
    console.log('Docker answers.');
    for (const note of beforeTheChainStarts(dockerMemory())) {
      console.log(note);
    }
  } else if (command === 'start') {
    await start();
  } else if (command === 'stop') {
    stop();
  } else {
    console.log('Say what to do: check, start or stop.');
    process.exit(2);
  }
} catch (error) {
  // The sentence saying what resolves the failure is printed on its own last
  // line, where a reader of the end of the output finds it, not under a stack.
  console.log(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
