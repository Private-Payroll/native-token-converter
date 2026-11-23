// SPDX-License-Identifier: Apache-2.0

/**
 * Which converters this release of the library names, and the one check that
 * a contract on a chain is one of them. A client that wraps or redeems through
 * a converter it has not checked can mint a token nobody will ever redeem, or
 * pay into a contract that can be changed to pay itself out.
 *
 * Everything the check trusts is in this file's code, fixed when the library
 * is released: each converter's addresses and the digest of the state it was
 * deployed with. Nothing is read from a file or a server that could change
 * after the release; the chain is read only through the caller's own reader,
 * and what it returns is compared with the release.
 */

import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { deployState, type Authority, type Constructible } from './deploy-state.js';

/**
 * The converter's authority: no committee member exists to sign, and one
 * signature is needed. The ledger accepts no change to a contract held this
 * way, so none of its circuits or keys can be added, replaced or removed once
 * it is deployed, by anyone, including whoever deployed it. What a later
 * ledger version does to deployed contracts is Midnight's, not the contract's.
 */
export const OWNERLESS: Authority = Object.freeze({ committee: Object.freeze([]), threshold: 1 });

/** One version of the converter, as a release of the library names it. */
export interface ReleasedConverter {
  /**
   * The SHA-256, in hex, of the converter's deploy state less its balances:
   * every circuit, the verifier key of each, its public data and its
   * authority, `OWNERLESS` at counter 0. Anyone can rebuild it from the tagged
   * source with the pinned compiler.
   */
  readonly deployState: string;
  /** Where it is deployed, by network id, as 64 lowercase hex characters. */
  readonly addresses: Readonly<Record<string, string>>;
}

/** Every version of the converter this release names, oldest first. */
export const RELEASED_CONVERTERS: readonly ReleasedConverter[] = Object.freeze([
  Object.freeze({
    deployState: '7c6d4dedafc07fbd914cf70bab85609ba574750735e5c1bec8735ec954f29fbf',
    addresses: Object.freeze({}),
  }),
]);

/**
 * The converter's deploy state, from its compiled contract and the verifier
 * key of each of its circuits: no constructor arguments, no private state, and
 * `OWNERLESS`. Its constructor makes no coins, so the coin key it runs as is
 * never used and is all zeros.
 */
export async function converterDeployState(
  contract: Constructible<undefined>,
  verifierKeys: Readonly<Record<string, Uint8Array>>,
): Promise<ContractState> {
  const built = await deployState({
    contract,
    args: [],
    initialPrivateState: undefined,
    coinPublicKey: '00'.repeat(32),
    verifierKeys,
    authority: OWNERLESS,
  });
  return built.state;
}

const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * The SHA-256 of `state` less its balances, which change with every wrap and
 * redeem: its public data, every circuit with its verifier key, and its
 * authority. The same value for the deploy state a deployment builds and for
 * that contract read back from the chain while nothing has changed it.
 */
export async function deployStateDigest(state: ContractState): Promise<string> {
  const lessBalances = new ContractState();
  lessBalances.data = state.data;
  for (const name of state.operations()) {
    const operation = state.operation(name);
    if (operation !== undefined) {
      lessBalances.setOperation(name, operation);
    }
  }
  lessBalances.maintenanceAuthority = state.maintenanceAuthority;
  return toHex(await crypto.subtle.digest('SHA-256', new Uint8Array(lessBalances.serialize())));
}

function readState(stateBytes: Uint8Array): ContractState | string {
  try {
    return ContractState.deserialize(stateBytes);
  } catch (error) {
    return `what was read is not a contract's state: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Every way `state`'s authority is not `OWNERLESS` at counter 0, or none. */
function authorityProblems(state: ContractState): string[] {
  const authority = state.maintenanceAuthority;
  const problems: string[] = [];
  if (authority.committee.length !== OWNERLESS.committee.length) {
    problems.push(
      `its authority names ${String(authority.committee.length)} key(s), and any key that can sign can replace its circuits`,
    );
  }
  if (authority.threshold < OWNERLESS.threshold) {
    problems.push(
      `its authority's threshold is ${String(authority.threshold)}, met with no signature at all, so anyone can change it`,
    );
  }
  if (authority.counter !== 0n) {
    problems.push(
      `its authority's counter is ${String(authority.counter)}, so it has been changed since it was deployed`,
    );
  }
  return problems;
}

/**
 * Every way the contract state `stateBytes` differs from the converter whose
 * deploy-state digest is `digest`, or none. The authority is checked first and
 * by name, because it decides whether anyone can change the contract: a
 * committee with any key in it, a threshold below one signature, and a counter
 * above 0, which means it has been changed since it was deployed. Then
 * everything but the balances is compared with the digest: an added or missing
 * circuit, a different verifier key and different public data all differ
 * there. Clients call `checkConverter`, and a deployment `converterProblems`,
 * which compare with this release only; the digest is a parameter here so the
 * comparison itself can be tested.
 *
 * The coins the converter keeps when it redeems stay out of circulation for
 * the same reason every pool's backing is safe: no circuit can be added to
 * spend them while the ledger holds the converter as it was deployed. This is
 * where that is established for a deployed converter, by its authority.
 */
export async function problemsAgainst(stateBytes: Uint8Array, digest: string): Promise<string[]> {
  const state = readState(stateBytes);
  if (typeof state === 'string') {
    return [state];
  }
  const problems = authorityProblems(state);
  const found = await deployStateDigest(state);
  if (found !== digest) {
    problems.push(
      `its circuits, verifier keys, public data or authority differ from the release: digest ${found}, released ${digest}`,
    );
  }
  return problems;
}

/**
 * The address of the newest converter in `converters` that names `networkId`,
 * once the state `read` returns for that address is checked to be it. Throws,
 * naming every problem, when none names that network, when there is no
 * contract at the address, or when the contract there is not that converter.
 */
export async function checkAgainst(
  networkId: string,
  read: (address: string) => Promise<Uint8Array | undefined>,
  converters: readonly ReleasedConverter[],
): Promise<string> {
  const converter = [...converters]
    .reverse()
    .find((each) => Object.hasOwn(each.addresses, networkId));
  const address = converter?.addresses[networkId];
  if (converter === undefined || address === undefined) {
    throw new Error(
      `this release of the library names no converter on the network ${JSON.stringify(networkId)}`,
    );
  }
  const stateBytes = await read(address);
  if (stateBytes === undefined) {
    throw new Error(`there is no contract at the converter's address ${address} on ${networkId}`);
  }
  const problems = await problemsAgainst(stateBytes, converter.deployState);
  if (problems.length > 0) {
    throw new Error(
      `the contract at ${address} on ${networkId} is not the converter this library was released for: ${problems.join('; ')}`,
    );
  }
  return address;
}

/** The newest converter this release names. */
function newest(): ReleasedConverter {
  const converter = RELEASED_CONVERTERS.at(-1);
  if (converter === undefined) {
    throw new Error('this release of the library names no converter');
  }
  return converter;
}

/**
 * Every way the contract state `stateBytes` differs from the newest converter
 * this release names, or none: the check a deployment makes of the state it
 * built before it is sent, and of the contract once it is on the chain. It
 * does not check where a contract is, so a client checks a converter only
 * with `checkConverter`, which takes the address from the release.
 */
export function converterProblems(stateBytes: Uint8Array): Promise<string[]> {
  return problemsAgainst(stateBytes, newest().deployState);
}

/**
 * The address of the converter this release names on `networkId`, once the
 * state `read` returns for it is checked to be that converter, deployed so
 * that no key can change it. Throws, naming every problem, otherwise.
 * `read` is the caller's own way to the chain, usually its indexer: it is
 * given the address and returns the serialized contract state there, or
 * undefined when there is no contract.
 */
export function checkConverter(
  networkId: string,
  read: (address: string) => Promise<Uint8Array | undefined>,
): Promise<string> {
  return checkAgainst(networkId, read, RELEASED_CONVERTERS);
}
