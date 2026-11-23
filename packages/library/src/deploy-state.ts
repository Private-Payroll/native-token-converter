// SPDX-License-Identifier: Apache-2.0

/**
 * The state a contract is deployed with: its constructor's public data, the
 * circuits it is deployed with and the verifier key of each, and who may
 * change it afterwards. This is the one place a deploy state is assembled, so
 * a deployment and anything that checks one agree on what was deployed.
 *
 * The constructor is the compiled contract's own `initialState`, run with
 * compact-runtime and nothing else. The authority is an input and is never
 * made up here: a contract held by keys is given them, and a contract nobody
 * may change is given an empty committee. Which authority a contract may have
 * is its deployer's rule, not this function's.
 */

import {
  ContractMaintenanceAuthority,
  ContractState,
  createConstructorContext,
  type CoinPublicKey,
  type ConstructorContext,
  type ConstructorResult,
  type SignatureVerifyingKey,
} from '@midnight-ntwrk/compact-runtime';

/** Who may change a deployed contract: any `threshold` of `committee` signing together. */
export interface Authority {
  readonly committee: readonly SignatureVerifyingKey[];
  readonly threshold: number;
}

/** A compiled contract, as its generated module's `Contract` class builds it with its witnesses. */
export interface Constructible<PS> {
  initialState(
    context: ConstructorContext<PS>,
    ...args: never[]
  ): ConstructorResult<PS> | Promise<ConstructorResult<PS>>;
}

/** What a deploy state is assembled from. */
export interface DeployStateInput<PS> {
  readonly contract: Constructible<PS>;
  /** The constructor's arguments, in order; none for a constructor that takes none. */
  readonly args: readonly unknown[];
  readonly initialPrivateState: PS;
  /** The coin key the constructor runs as. A constructor that makes or spends coins is refused. */
  readonly coinPublicKey: CoinPublicKey;
  /**
   * The circuits to deploy, by name, each with its verifier key as the
   * compiler wrote it. Exactly these are deployed; a circuit the contract
   * declares and is not named here is left out.
   */
  readonly verifierKeys: Readonly<Record<string, Uint8Array>>;
  readonly authority: Authority;
}

/** A deploy state, and the private state the constructor left. */
export interface BuiltDeployState<PS> {
  readonly state: ContractState;
  readonly privateState: PS;
}

/**
 * Refuses a threshold that is not a whole number of signatures of at least
 * one. A threshold of nothing is met by no signature at all, so it would let
 * anyone change the contract.
 */
function requireThreshold(authority: Authority): void {
  const { threshold } = authority;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 0xffff_ffff) {
    throw new Error(
      `a contract's authority needs a threshold of at least one signature; got ${String(threshold)}. Nothing was built.`,
    );
  }
}

/**
 * The deploy state of `input.contract`: its constructor's public data, the
 * circuits named in `input.verifierKeys` with those keys, and
 * `input.authority` at counter 0. Refuses, before anything is returned, a
 * threshold below one, no circuit to deploy, a key for a circuit the contract
 * does not declare, and a constructor that made or spent coins, which a deploy
 * carries none of.
 */
export async function deployState<PS>(input: DeployStateInput<PS>): Promise<BuiltDeployState<PS>> {
  requireThreshold(input.authority);
  const named = Object.keys(input.verifierKeys);
  if (named.length === 0) {
    throw new Error(
      'a contract is deployed with at least one circuit, and no key was given. Nothing was built.',
    );
  }
  const constructed = await input.contract.initialState(
    createConstructorContext(input.initialPrivateState, input.coinPublicKey),
    ...(input.args as never[]),
  );
  const coins = constructed.currentZswapLocalState;
  if (coins.outputs.length > 0 || coins.inputs.length > 0) {
    throw new Error(
      "the contract's constructor made or spent coins, and a deploy carries none. Nothing was built.",
    );
  }
  const declared = constructed.currentContractState;
  const state = new ContractState();
  state.data = declared.data;
  for (const name of named) {
    const operation = declared.operation(name);
    const key = input.verifierKeys[name];
    if (operation === undefined || key === undefined) {
      throw new Error(
        `the contract declares no circuit "${name}" to deploy with a key. Nothing was built.`,
      );
    }
    operation.verifierKey = key;
    state.setOperation(name, operation);
  }
  state.maintenanceAuthority = new ContractMaintenanceAuthority(
    [...input.authority.committee],
    input.authority.threshold,
    0n,
  );
  return { state, privateState: constructed.currentPrivateState };
}
