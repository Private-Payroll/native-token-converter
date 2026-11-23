// SPDX-License-Identifier: Apache-2.0

/**
 * The node, indexer and proof server a contract is deployed and called
 * against on a local development chain.
 *
 * Each service is either named by an environment variable, and then used as it
 * is, or started here with Docker from the images pinned in
 * tools/toolchain/src/toolchain.ts, on a network and under container names of its own so
 * two runs on one machine do not collide. A service that never answers is
 * refused, naming it and the command that shows why.
 */

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { INDEXER_IMAGE, NODE_IMAGE, PROOF_SERVER_IMAGE } from '@native-token-converter/toolchain';

/** The three services, by the name a person would use for each. */
export type Service = 'node' | 'indexer' | 'proof server';

/** The environment variable that names an already running instance of each service. */
export const ENDPOINT_VARIABLES: Readonly<Record<Service, string>> = {
  node: 'LOCAL_CHAIN_NODE',
  indexer: 'LOCAL_CHAIN_INDEXER',
  'proof server': 'LOCAL_CHAIN_PROOF_SERVER',
};

/** The port each service listens on inside its container. */
export const SERVICE_PORTS: Readonly<Record<Service, number>> = {
  node: 9944,
  indexer: 8088,
  'proof server': 6300,
};

/** The network id a development chain runs under. */
export const LOCAL_NETWORK_ID = 'undeployed';

/** Where the indexer serves its GraphQL API, under its base address. */
export const INDEXER_GRAPHQL_PATH = '/api/v4/graphql';

/** The base address of each service, as `http://host:port` with no trailing slash. */
export type Endpoints = Readonly<Record<Service, string>>;

const SERVICES: readonly Service[] = ['node', 'indexer', 'proof server'];

/** The image each service is started from: the pins, in one place. */
export const SERVICE_IMAGES: Readonly<Record<Service, string>> = {
  node: NODE_IMAGE,
  indexer: INDEXER_IMAGE,
  'proof server': PROOF_SERVER_IMAGE,
};

/** Each service's address on this machine when it publishes its standard port, as a kept chain does. */
export function standardEndpoints(): Endpoints {
  const at = (service: Service): string => `http://127.0.0.1:${String(SERVICE_PORTS[service])}`;
  return { node: at('node'), indexer: at('indexer'), 'proof server': at('proof server') };
}

/**
 * The memory, in bytes, Docker is given below which proving may fail: the
 * proof server alone holds about 2 GiB while it proves a call, beside the node
 * and the indexer.
 */
export const DOCKER_MEMORY_FLOOR = 4 * 1024 ** 3;

/** How long a started service is waited for until it answers, by default. */
export const SECONDS_TO_ANSWER = 180;

/**
 * What somebody starting the chain's tests should know before they wait, given
 * the memory Docker reports in bytes: the first run downloads the three
 * images, every run's proof server downloads its proving parameters before it
 * answers and is waited for only so long, and too little memory for Docker, or
 * none reported, is named with how to give it more.
 */
export function beforeTheChainStarts(dockerMemory: number): string[] {
  const minutes = String(SECONDS_TO_ANSWER / 60);
  const notes = [
    "The first run downloads the node, indexer and proof server images, about 1.5 GB, and every run's " +
      `proof server downloads its proving parameters from Midnight before it answers, which is waited for ` +
      `up to ${minutes} minutes. Only Docker's own logs show either while it runs.`,
  ];
  const gib = (bytes: number): string => (bytes / 1024 ** 3).toFixed(1);
  const give = `In Docker Desktop, open Settings, then Resources, and give it at least ${gib(DOCKER_MEMORY_FLOOR)} GiB.`;
  if (!Number.isFinite(dockerMemory) || dockerMemory <= 0) {
    notes.push(
      `Docker did not say how much memory it has, and proving needs about 2 GiB in the proof server alone. ${give}`,
    );
  } else if (dockerMemory < DOCKER_MEMORY_FLOOR) {
    notes.push(
      `Docker has ${gib(dockerMemory)} GiB of memory, and proving needs about 2 GiB in the proof server alone. ${give}`,
    );
  }
  return notes;
}

/** The memory Docker reports, in bytes. */
export function dockerMemory(): number {
  return Number(docker(['info', '--format', '{{.MemTotal}}']));
}

/** Why Docker cannot be used here, or undefined when it answers. */
export function dockerProblem(): string | undefined {
  try {
    docker(['info', '--format', '{{.ServerVersion}}']);
    return undefined;
  } catch {
    // Either the command is missing or the daemon is not running; the same
    // two steps fix both, so they are not told apart.
    return 'Docker is not installed or not running on this machine. Install Docker Desktop, start it, wait until it says it is running, then try again.';
  }
}

/**
 * The address an environment variable gives for a service, or undefined when
 * the variable is unset or empty. Anything that is not an http address with a
 * host is refused, because a mistyped address would otherwise surface much
 * later as a connection that hangs.
 */
export function endpointFromEnvironment(
  service: Service,
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const variable = ENDPOINT_VARIABLES[service];
  const raw = environment[variable]?.trim();
  if (raw === undefined || raw === '') {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (cause) {
    throw new Error(badEndpoint(variable, raw), { cause });
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.hostname === '') {
    throw new Error(badEndpoint(variable, raw));
  }
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error(badEndpoint(variable, raw));
  }
  return `${parsed.protocol}//${parsed.host}`;
}

function badEndpoint(variable: string, raw: string): string {
  return (
    `${variable} is ${JSON.stringify(raw)}, which is not the base address of a running service. ` +
    `Set it to one like http://127.0.0.1:${String(SERVICE_PORTS.node)}, with no path, or unset it to have the service started here.`
  );
}

/**
 * The refusal for a service that never answered. It names the service, where
 * it was asked, and what to do next: read the container's log when it was
 * started here, or check the variable that named it when it was not.
 */
export function neverAnswered(
  service: Service,
  endpoint: string,
  seconds: number,
  container: string | undefined,
): string {
  const next =
    container === undefined
      ? `Check that ${ENDPOINT_VARIABLES[service]} names a ${service} that is running, or unset it to have one started here.`
      : `Read its log with: docker logs ${container}`;
  return `the ${service} at ${endpoint} did not answer within ${String(seconds)} seconds. ${next}`;
}

/**
 * What the wallet and the contract providers are configured with, derived from
 * the three base addresses.
 */
export function environmentConfiguration(endpoints: Endpoints): EnvironmentConfiguration {
  const ws = (http: string): string => http.replace(/^http/, 'ws');
  const graphql = `${endpoints.indexer}${INDEXER_GRAPHQL_PATH}`;
  return {
    walletNetworkId: LOCAL_NETWORK_ID,
    networkId: LOCAL_NETWORK_ID,
    indexer: graphql,
    indexerWS: `${ws(graphql)}/ws`,
    node: endpoints.node,
    nodeWS: ws(endpoints.node),
    proofServer: endpoints['proof server'],
    faucet: undefined,
  };
}

/** Whether a service answers the one question it is asked to prove it is up. */
async function answers(service: Service, endpoint: string): Promise<boolean> {
  try {
    if (service === 'node') {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_getHeader', params: [] }),
        signal: AbortSignal.timeout(5_000),
      });
      const body = (await response.json()) as { readonly result?: { readonly number?: string } };
      return response.ok && typeof body.result?.number === 'string';
    }
    const path = service === 'indexer' ? '/ready' : '/version';
    const response = await fetch(`${endpoint}${path}`, { signal: AbortSignal.timeout(5_000) });
    return response.ok;
  } catch {
    // Not answering yet is the expected state while a service starts; the
    // caller decides when waiting has gone on too long.
    return false;
  }
}

/** Waits until a service answers, or throws the refusal naming it. */
export async function waitUntilAnswering(
  service: Service,
  endpoint: string,
  seconds: number,
  container: string | undefined,
): Promise<void> {
  const deadline = Date.now() + seconds * 1_000;
  while (Date.now() < deadline) {
    if (await answers(service, endpoint)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new ServiceDidNotAnswer(neverAnswered(service, endpoint, seconds, container));
}

/**
 * Why the services named in the environment cannot work together, or
 * undefined. A started indexer follows the node started beside it, so the
 * node and the indexer are named together or started together; the proof
 * server keeps no chain state and may be named alone.
 */
export function partialChainProblem(
  given: Readonly<Record<Service, string | undefined>>,
): string | undefined {
  if ((given.node === undefined) === (given.indexer === undefined)) {
    return undefined;
  }
  const [named, missing]: [Service, Service] =
    given.node === undefined ? ['indexer', 'node'] : ['node', 'indexer'];
  return `${ENDPOINT_VARIABLES[named]} is set and ${ENDPOINT_VARIABLES[missing]} is not: an indexer follows one node, so set both to use running ones, or neither to start both here`;
}

/** The refusal a service earns by never answering. */
export class ServiceDidNotAnswer extends Error {
  override readonly name = 'ServiceDidNotAnswer';
}

/** The command that removes what a run started, for a person to run once they have read the logs. */
export function removalCommand(names: RunNames, started: readonly Service[]): string {
  const containers = started.map((service) => names.containers[service]).join(' ');
  return `The containers were left running; remove them with: docker rm --force ${containers} && docker network rm ${names.network}`;
}

/** Runs one Docker command and returns what it printed, trimmed. */
export function docker(args: readonly string[]): string {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** The containers and network one run started, named after that run. */
export interface RunNames {
  readonly network: string;
  readonly containers: Readonly<Record<Service, string>>;
}

/** Names for one run: a shared prefix and a random suffix, so runs do not collide. */
export function runNames(suffix: string = randomBytes(4).toString('hex')): RunNames {
  const prefix = `local-chain-${suffix}`;
  return {
    network: prefix,
    containers: {
      node: `${prefix}-node`,
      indexer: `${prefix}-indexer`,
      'proof server': `${prefix}-proof-server`,
    },
  };
}

/** The `docker run` arguments for a service, given the node's name on the run's network. */
function runArguments(service: Service, names: RunNames, standardPorts: boolean): string[] {
  const base = ['run', '--detach', '--name', names.containers[service], '--network', names.network];
  const host = standardPorts ? String(SERVICE_PORTS[service]) : '';
  const port = ['--publish', `127.0.0.1:${host}:${String(SERVICE_PORTS[service])}`];
  if (service === 'node') {
    return [...base, ...port, '--env', 'CFG_PRESET=dev', SERVICE_IMAGES.node];
  }
  if (service === 'indexer') {
    // A standalone indexer keeps its own storage, sealed with these; the
    // values only have to agree with each other inside this one container.
    // It also refuses to start without a stake pool data source configured,
    // which a development chain has no use for, so it is given a placeholder
    // and told not to retry it for a day.
    const environment = {
      APP__INFRA__SPO_NODE__BLOCKFROST_ID: 'unused',
      APP__INFRA__SPO_NODE__RECONNECT_MAX_DELAY: '24h',
      APP__APPLICATION__NETWORK_ID: LOCAL_NETWORK_ID,
      APP__INFRA__NODE__URL: `ws://${names.containers.node}:${String(SERVICE_PORTS.node)}`,
      APP__INFRA__STORAGE__PASSWORD: 'indexer',
      APP__INFRA__PUB_SUB__PASSWORD: 'indexer',
      APP__INFRA__LEDGER_STATE_STORAGE__PASSWORD: 'indexer',
      APP__INFRA__SECRET: randomBytes(32).toString('hex'),
    };
    const flags = Object.entries(environment).flatMap(([key, value]) => [
      '--env',
      `${key}=${value}`,
    ]);
    return [...base, ...port, ...flags, SERVICE_IMAGES.indexer];
  }
  return [...base, ...port, SERVICE_IMAGES['proof server']];
}

/** A local chain: where its services are, and how to stop what was started for it. */
export interface LocalChain {
  readonly endpoints: Endpoints;
  readonly configuration: EnvironmentConfiguration;
  /** The services this run started, as opposed to found running. */
  readonly started: readonly Service[];
  /** Stops and removes every container and the network this run started, and nothing else. */
  stop(): void;
}

/** How long each service is given to answer before it is refused. */
export interface StartOptions {
  readonly secondsToAnswer?: number;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /**
   * A name for a chain meant to outlive the process that starts it, such as
   * one a browser wallet connects to. Its services publish their standard
   * ports, so its endpoints are always the same, and `removeLocalChain` with
   * the same name stops it. Without a name, each run gets fresh names and
   * ports and nothing it starts collides with another run.
   */
  readonly keptAs?: string;
}

/**
 * Starts the services no environment variable names, waits until all three
 * answer, and returns where they are. Anything started is stopped again before
 * a refusal is thrown, so a failed start leaves nothing running.
 */
export async function startLocalChain(options: StartOptions = {}): Promise<LocalChain> {
  const environment = options.environment ?? process.env;
  const seconds = options.secondsToAnswer ?? SECONDS_TO_ANSWER;
  const names = runNames(options.keptAs);
  const given: Record<Service, string | undefined> = {
    node: endpointFromEnvironment('node', environment),
    indexer: endpointFromEnvironment('indexer', environment),
    'proof server': endpointFromEnvironment('proof server', environment),
  };
  const partial = partialChainProblem(given);
  if (partial !== undefined) {
    throw new Error(partial);
  }
  const started: Service[] = [];
  let networkCreated = false;
  const stop = (): void => {
    const left: string[] = [];
    for (const service of started) {
      try {
        docker(['rm', '--force', '--volumes', names.containers[service]]);
      } catch {
        left.push(names.containers[service]);
      }
    }
    if (networkCreated) {
      try {
        docker(['network', 'rm', names.network]);
      } catch {
        left.push(names.network);
      }
    }
    if (left.length > 0) {
      // Each removal is tried even when an earlier one failed, and what is
      // left is named rather than hidden behind the first failure.
      throw new Error(
        `could not remove ${left.join(', ')}; remove them in Docker Desktop or with docker rm`,
      );
    }
  };
  const endpoints: Record<Service, string> = { node: '', indexer: '', 'proof server': '' };
  try {
    for (const service of SERVICES) {
      const supplied = given[service];
      if (supplied === undefined) {
        if (!networkCreated) {
          docker(['network', 'create', names.network]);
          networkCreated = true;
        }
        // Counted as started before it runs: a `docker run` that fails after
        // creating the container (a port already taken) still leaves one to
        // remove.
        started.push(service);
        docker(runArguments(service, names, options.keptAs !== undefined));
        const published = docker([
          'port',
          names.containers[service],
          `${String(SERVICE_PORTS[service])}/tcp`,
        ]);
        endpoints[service] = `http://${published.split('\n')[0] ?? ''}`;
      } else {
        endpoints[service] = supplied;
      }
      const container = supplied === undefined ? names.containers[service] : undefined;
      await waitUntilAnswering(service, endpoints[service], seconds, container);
    }
  } catch (error) {
    if (!(error instanceof ServiceDidNotAnswer) || started.length === 0) {
      // The failure that stopped the start is the one reported; a failure to
      // clean up after it is added to it, never put in its place. Both are
      // the aggregate's errors, and the cleanup is its cause.
      try {
        stop();
      } catch (cleanup) {
        throw new AggregateError(
          [error, cleanup],
          `${String(error instanceof Error ? error.message : error)}; and ${String(cleanup instanceof Error ? cleanup.message : cleanup)}`,
          { cause: cleanup },
        );
      }
      throw error;
    }
    // The containers are left in place so the log the refusal names can be
    // read; the refusal says how to remove them afterwards.
    throw new Error(`${error.message} ${removalCommand(names, started)}`, { cause: error });
  }
  return { endpoints, configuration: environmentConfiguration(endpoints), started, stop };
}

/**
 * Stops and removes the services and network of the chain started with
 * `keptAs: name`, and says which it found. Containers of any other name are
 * never touched.
 */
export function removeLocalChain(name: string): string[] {
  const names = runNames(name);
  const present = new Set(docker(['ps', '--all', '--format', '{{.Names}}']).split('\n'));
  const removed = SERVICES.map((service) => names.containers[service]).filter((container) =>
    present.has(container),
  );
  if (removed.length > 0) {
    docker(['rm', '--force', '--volumes', ...removed]);
  }
  const networks = new Set(docker(['network', 'ls', '--format', '{{.Name}}']).split('\n'));
  if (networks.has(names.network)) {
    docker(['network', 'rm', names.network]);
    removed.push(names.network);
  }
  return removed;
}
