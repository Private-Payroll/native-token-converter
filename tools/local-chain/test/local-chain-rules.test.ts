// SPDX-License-Identifier: Apache-2.0

/**
 * The rules a local chain is started by, checked without starting one: the
 * images it runs are pinned exactly, once each; an address named in the
 * environment is taken only when it is a base address; and a service that
 * never answers is refused with what to do about it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ENDPOINT_VARIABLES,
  endpointFromEnvironment,
  environmentConfiguration,
  neverAnswered,
  partialChainProblem,
  removalCommand,
  runNames,
} from '../src/services.js';
import { INDEXER_IMAGE, NODE_IMAGE, PROOF_SERVER_IMAGE } from '@native-token-converter/toolchain';

const IMAGES = { node: NODE_IMAGE, indexer: INDEXER_IMAGE, 'proof server': PROOF_SERVER_IMAGE };

describe('the pinned images', () => {
  it('name each service by an exact version and a sha256 digest', () => {
    for (const image of Object.values(IMAGES)) {
      expect(image).toMatch(/^midnightntwrk\/[a-z-]+:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
    }
  });

  it('are three different images', () => {
    const repositories = Object.values(IMAGES).map((image) => image.split(':')[0]);
    expect(new Set(repositories).size).toBe(3);
  });

  it('are written in the toolchain file and nowhere else in the harness', () => {
    const files = readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.ts'));
    expect(files).toContain('services.ts');
    for (const file of files) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/midnightntwrk\/[a-z-]+:\d/);
    }
  });
});

describe('an address named in the environment', () => {
  const named = (value: string | undefined): string | undefined =>
    endpointFromEnvironment('node', { [ENDPOINT_VARIABLES.node]: value });

  it('is used when it is set, without a trailing slash', () => {
    expect(named('http://127.0.0.1:9944')).toBe('http://127.0.0.1:9944');
    expect(named('http://127.0.0.1:9944/')).toBe('http://127.0.0.1:9944');
  });

  it('is not used when it is unset or empty, so the service is started instead', () => {
    expect(named(undefined)).toBeUndefined();
    expect(named('')).toBeUndefined();
    expect(named('   ')).toBeUndefined();
  });

  it('is refused when it is not an http address, naming the variable and the value', () => {
    expect(() => named('127.0.0.1:9944')).toThrow(/LOCAL_CHAIN_NODE is "127.0.0.1:9944"/);
    expect(() => named('ws://127.0.0.1:9944')).toThrow(/LOCAL_CHAIN_NODE/);
  });

  it('is refused when it carries a path, which the harness adds itself', () => {
    expect(() => named('http://127.0.0.1:8088/api/v4/graphql')).toThrow(/with no path/);
  });

  it('is read from one variable per service', () => {
    expect(new Set(Object.values(ENDPOINT_VARIABLES)).size).toBe(3);
  });
});

describe('what the wallet and providers are pointed at', () => {
  const configuration = environmentConfiguration({
    node: 'http://127.0.0.1:9944',
    indexer: 'http://127.0.0.1:8088',
    'proof server': 'http://127.0.0.1:6300',
  });

  it("is the indexer's GraphQL API over http and over a web socket", () => {
    expect(configuration.indexer).toBe('http://127.0.0.1:8088/api/v4/graphql');
    expect(configuration.indexerWS).toBe('ws://127.0.0.1:8088/api/v4/graphql/ws');
  });

  it('is the node over http and over a web socket, on a development chain', () => {
    expect(configuration.node).toBe('http://127.0.0.1:9944');
    expect(configuration.nodeWS).toBe('ws://127.0.0.1:9944');
    expect(configuration.networkId).toBe('undeployed');
  });
});

describe('a service that never answers', () => {
  it('is named, with where it was asked and how long it was given', () => {
    const refusal = neverAnswered('indexer', 'http://127.0.0.1:8088', 180, 'a-container');
    expect(refusal).toMatch(
      /^the indexer at http:\/\/127\.0\.0\.1:8088 did not answer within 180 seconds/,
    );
  });

  it('says how to read its log when it was started here', () => {
    expect(neverAnswered('node', 'http://x:1', 5, 'a-container')).toMatch(
      /docker logs a-container/,
    );
  });

  it('says which variable to check when it was named rather than started', () => {
    const refusal = neverAnswered('proof server', 'http://x:1', 5, undefined);
    expect(refusal).toMatch(
      /Check that LOCAL_CHAIN_PROOF_SERVER names a proof server that is running/,
    );
    expect(refusal).not.toMatch(/docker logs/);
  });

  it('says how to remove what was left running for its log to be read', () => {
    const names = runNames('abc');
    expect(removalCommand(names, ['node', 'indexer'])).toMatch(
      /docker rm --force local-chain-abc-node local-chain-abc-indexer && docker network rm local-chain-abc$/,
    );
  });
});

describe('the names one run starts its services under', () => {
  it('differ between runs, so two runs on one machine do not collide', () => {
    expect(runNames().network).not.toBe(runNames().network);
  });

  it('share the run network name as a prefix', () => {
    const names = runNames('abc');
    for (const container of Object.values(names.containers)) {
      expect(container.startsWith(`${names.network}-`)).toBe(true);
    }
  });
});

describe('services named in the environment', () => {
  const none = { node: undefined, indexer: undefined, 'proof server': undefined };
  const at = 'http://127.0.0.1:1';

  it('may be none, all, or the node and the indexer together, with or without the proof server', () => {
    expect(partialChainProblem(none)).toBeUndefined();
    expect(partialChainProblem({ node: at, indexer: at, 'proof server': at })).toBeUndefined();
    expect(partialChainProblem({ ...none, node: at, indexer: at })).toBeUndefined();
    expect(partialChainProblem({ ...none, 'proof server': at })).toBeUndefined();
  });

  it('are refused when only one of the node and the indexer is named, naming both variables', () => {
    expect(partialChainProblem({ ...none, node: at })).toMatch(
      /LOCAL_CHAIN_NODE is set and LOCAL_CHAIN_INDEXER is not/,
    );
    expect(partialChainProblem({ ...none, indexer: at, 'proof server': at })).toMatch(
      /LOCAL_CHAIN_INDEXER is set and LOCAL_CHAIN_NODE is not/,
    );
  });
});
