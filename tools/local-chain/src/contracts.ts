// SPDX-License-Identifier: Apache-2.0

/**
 * Deploys any compiled contract on a local chain and calls its circuits,
 * measuring every transaction as it goes.
 *
 * The deploy and call pipeline is Midnight.js's own: this builds its providers
 * for one compiled contract and a wallet, and wraps the proof and submission
 * providers to time them. Sizes, modelled costs and fees are read off the
 * finalized transaction with the ledger's own API, under the parameters of the
 * block it landed in. A contract with private state or witnesses is outside
 * what this offers and is refused by the types rather than at run time.
 */

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { CompiledContract, type Contract } from '@midnight-ntwrk/compact-js';
import {
  ContractState,
  type ContractModuleProvider,
  type Module,
  type StateValue,
} from '@midnight-ntwrk/compact-runtime';
import {
  deployContract,
  type Ledger9DeployContractOptionsBase,
  type Ledger9DeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import {
  ZKConfigRegistry,
  type Ledger9FinalizedTxData,
  type MidnightProvider,
  type MidnightProviders,
  type ProofProvider,
  type WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import {
  inMemoryPrivateStateProvider,
  type EnvironmentConfiguration,
} from '@midnight-ntwrk/testkit-js';
import {
  LedgerParameters,
  Transaction,
  type NormalizedCost,
  type SyntheticCost,
} from '@midnightntwrk/ledger-v9';
import type { LocalWallet } from './wallet.js';

/** A compiled contract with no private state, which is every contract this deploys. */
export type StatelessContract = Contract<undefined>;

/** The compiled contract, as Midnight.js takes it. */
export type Compiled<C extends StatelessContract> = CompiledContract.CompiledContract<C, undefined>;

/**
 * The generated module in a build folder, as `import()` returns it. The caller
 * names its type, normally `typeof import('<build>/contract/index.js')` of a
 * build of the same source: nothing at run time checks that it is right.
 */
export async function importCompiledModule<M>(buildDirectory: string): Promise<M> {
  const loaded: unknown = await import(
    pathToFileURL(join(buildDirectory, 'contract', 'index.js')).href
  );
  return loaded as M;
}

/**
 * A compiled contract bound to the folder its keys and circuits were built
 * into, for a contract that declares no witnesses.
 */
export function compiledContract<C extends StatelessContract>(
  tag: string,
  constructor: new (witnesses: Record<string, never>) => C,
  buildDirectory: string,
): Compiled<C> {
  return CompiledContract.make<C, undefined>(tag, constructor).pipe(
    CompiledContract.withVacantWitnesses,
    CompiledContract.withCompiledFileAssets(buildDirectory),
  );
}

/** How long the slow steps of the last transaction took. */
interface Clock {
  provingMilliseconds: number;
  balancingMilliseconds: number;
  submittedAt: number | undefined;
}

/** The providers one contract is deployed and called through, and the clock they report to. */
export interface ContractProviders {
  readonly providers: MidnightProviders;
  readonly clock: Clock;
}

/** A deployed contract that a circuit calls into, and the folder it was built into. */
export interface Callee {
  readonly address: string;
  readonly buildDirectory: string;
}

/** What else a contract's providers may need. */
export interface ProviderOptions {
  /**
   * The contracts a circuit of this one calls into. Each callee's address is
   * resolved to the module built in its folder, and its keys are served from
   * there to prove its part of the call. Needed only by a contract that calls
   * another one.
   */
  readonly callees?: readonly Callee[];
}

/**
 * Resolves each callee's address to the module built in its folder. Any other
 * address resolves to nothing, which the runtime reports as an unsupported
 * implementation naming the address.
 */
export function calleeModules(callees: readonly Callee[]): ContractModuleProvider {
  const byAddress = new Map(callees.map((callee) => [callee.address, callee.buildDirectory]));
  return {
    resolve(calleeAddress) {
      const buildDirectory = byAddress.get(calleeAddress);
      return buildDirectory === undefined
        ? undefined
        : () => importCompiledModule<Module>(buildDirectory);
    },
  };
}

function timedProofProvider(inner: ProofProvider, clock: Clock): ProofProvider {
  return {
    supportedEras: inner.supportedEras,
    async proveTx(unproven, config) {
      const started = performance.now();
      const proven = await inner.proveTx(unproven, config);
      clock.provingMilliseconds += performance.now() - started;
      return proven;
    },
  };
}

function timedWalletProvider(inner: WalletProvider, clock: Clock): WalletProvider {
  return {
    supportedEras: inner.supportedEras,
    async balanceTx(tx, ttl) {
      const started = performance.now();
      const balanced = await inner.balanceTx(tx, ttl);
      clock.balancingMilliseconds += performance.now() - started;
      return balanced;
    },
    getCoinPublicKey: () => inner.getCoinPublicKey(),
    getEncryptionPublicKey: () => inner.getEncryptionPublicKey(),
  };
}

function timedMidnightProvider(inner: MidnightProvider, clock: Clock): MidnightProvider {
  return {
    supportedEras: inner.supportedEras,
    submitTx(tx) {
      clock.submittedAt = performance.now();
      return inner.submitTx(tx);
    },
  };
}

/**
 * The providers for the contract built into `buildDirectory`, through
 * `wallet`. Private state is held in memory and is gone with the process.
 */
export function contractProviders(
  wallet: LocalWallet,
  configuration: EnvironmentConfiguration,
  buildDirectory: string,
  options: ProviderOptions = {},
): ContractProviders {
  const clock: Clock = { provingMilliseconds: 0, balancingMilliseconds: 0, submittedAt: undefined };
  const zkConfigProvider = new NodeZkConfigProvider(buildDirectory);
  const callees = options.callees ?? [];
  // A call into another contract carries one proof per contract it reaches,
  // so the proof server is served the keys of every one of them, each chosen
  // by the verifier key deployed at the address it is proved for.
  const keys =
    callees.length === 0
      ? zkConfigProvider
      : new ZKConfigRegistry([
          zkConfigProvider,
          ...callees.map((callee) => new NodeZkConfigProvider(callee.buildDirectory)),
        ]);
  const proofProvider = httpClientProofProvider({
    url: configuration.proofServer,
    zkConfigProvider: keys,
  });
  const providers: MidnightProviders = {
    privateStateProvider: inMemoryPrivateStateProvider(),
    publicDataProvider: indexerPublicDataProvider({
      queryURL: configuration.indexer,
      subscriptionURL: configuration.indexerWS,
    }),
    zkConfigProvider,
    proofProvider: timedProofProvider(proofProvider, clock),
    walletProvider: timedWalletProvider(wallet.provider, clock),
    midnightProvider: timedMidnightProvider(wallet.provider, clock),
    config: { networkId: configuration.networkId, ttlSeconds: 3600 },
    ...(callees.length === 0 ? {} : { contractModuleProvider: calleeModules(callees) }),
  };
  return { providers, clock };
}

/** What one finalized transaction measured. */
export interface Measurement {
  /** What the transaction did: `deploy`, or the circuit it called. */
  readonly label: string;
  /** The finalized transaction, serialized, in bytes. */
  readonly bytes: number;
  /** The ledger's modelled cost of the transaction under its block's parameters. */
  readonly cost: SyntheticCost;
  /**
   * Each part of that cost as a share of what one block may hold under the
   * same parameters, between 0 and 1: the largest of them bounds how many
   * transactions like this one fit in a block.
   */
  readonly blockShare: NormalizedCost;
  /** The fee the ledger computes for it under those parameters, in SPECKs of DUST. */
  readonly fees: bigint;
  /** The fee the indexer records as paid. */
  readonly paidFees: string;
  /** Proving the contract's own circuits, on the proof server. */
  readonly provingSeconds: number;
  /**
   * The wallet balancing the transaction: choosing the coins that pay for it
   * and pay the fee, proving their spends on the proof server, and signing.
   */
  readonly balancingSeconds: number;
  /** From handing the transaction to the node to the indexer reporting it final. */
  readonly submitToFinalSeconds: number;
  readonly blockHeight: number;
  readonly blockHash: string;
  readonly txId: string;
}

async function measure(
  label: string,
  record: Ledger9FinalizedTxData,
  contractAddress: string,
  { providers, clock }: ContractProviders,
  finalizedAt: number,
): Promise<Measurement> {
  const read = await providers.publicDataProvider.queryContractState(contractAddress, {
    type: 'blockHash',
    blockHash: record.blockHash,
  });
  if (read === null) {
    throw new Error(
      `the indexer has no state for ${contractAddress} at block ${record.blockHash}, where it reported the ${label} final`,
    );
  }
  const parameters = LedgerParameters.deserialize(read.ledgerParameters.serialize());
  const tx = record.tx.deserialize({ v9: Transaction });
  const cost = tx.cost(parameters);
  return {
    label,
    bytes: record.tx.serialize().length,
    cost,
    blockShare: parameters.normalizeFullness(cost),
    fees: tx.fees(parameters),
    paidFees: record.fees.paidFees,
    provingSeconds: clock.provingMilliseconds / 1_000,
    balancingSeconds: clock.balancingMilliseconds / 1_000,
    submitToFinalSeconds:
      clock.submittedAt === undefined ? Number.NaN : (finalizedAt - clock.submittedAt) / 1_000,
    blockHeight: record.blockHeight,
    blockHash: record.blockHash,
    txId: record.txId,
  };
}

function resetClock(clock: Clock): void {
  clock.provingMilliseconds = 0;
  clock.balancingMilliseconds = 0;
  clock.submittedAt = undefined;
}

/** A deployed contract, the providers it was deployed through, and what deploying it measured. */
export interface Deployed<C extends StatelessContract> {
  readonly contract: Ledger9DeployedContract<C>;
  readonly address: string;
  readonly through: ContractProviders;
  readonly measurement: Measurement;
}

/** Deploys `compiled` with the constructor arguments `args`, and waits until it is final. */
export async function deploy<C extends StatelessContract>(
  through: ContractProviders,
  compiled: Compiled<C>,
  args: Contract.InitializeParameters<C>,
): Promise<Deployed<C>> {
  resetClock(through.clock);
  const options: Ledger9DeployContractOptionsBase<C> = { compiledContract: compiled, args };
  const contract = await deployContract(through.providers, options);
  const finalizedAt = performance.now();
  const address = contract.deployTxData.public.contractAddress;
  const measurement = await measure(
    'deploy',
    contract.deployTxData.public,
    address,
    through,
    finalizedAt,
  );
  return { contract, address, through, measurement };
}

/** What a call returned, and what it measured. */
export interface Called<C extends StatelessContract, K extends Contract.ProvableCircuitId<C>> {
  readonly result: Contract.CircuitReturnType<C, K>;
  readonly measurement: Measurement;
}

/** Calls `circuit` of a deployed contract with `args`, and waits until the call is final. */
export async function call<C extends StatelessContract, K extends Contract.ProvableCircuitId<C>>(
  deployed: Deployed<C>,
  circuit: K,
  args: Contract.CircuitParameters<C, K>,
): Promise<Called<C, K>> {
  resetClock(deployed.through.clock);
  const finalized = await deployed.contract.callTx[circuit](...args);
  const finalizedAt = performance.now();
  const measurement = await measure(
    circuit,
    finalized.public,
    deployed.address,
    deployed.through,
    finalizedAt,
  );
  return { result: finalized.private.result, measurement };
}

/**
 * The public state of the contract at `address`, as the indexer last reports
 * it, for the generated `ledger` function to read. Refuses when the indexer
 * has no contract there.
 */
export async function contractState(
  through: ContractProviders,
  address: string,
): Promise<StateValue> {
  const read = await through.providers.publicDataProvider.queryContractState(address);
  if (read === null) {
    throw new Error(
      `the indexer has no contract at ${address}; check that it was deployed on this chain`,
    );
  }
  return read.contractState.deserialize({ v9: ContractState }).data.state;
}

/**
 * The unshielded tokens the contract at `address` holds, by colour as 64 hex
 * characters, as the indexer last reports them.
 */
export async function contractBalances(
  through: ContractProviders,
  address: string,
): Promise<Readonly<Record<string, bigint>>> {
  const balances =
    (await through.providers.publicDataProvider.queryUnshieldedBalances(address)) ?? [];
  return Object.fromEntries(balances.map(({ tokenType, balance }) => [tokenType, balance]));
}

/** The part of a block a transaction fills most, named, with its share. */
export function largestShare(share: NormalizedCost): string {
  const [part, value] = Object.entries(share).reduce((most, each) =>
    each[1] > most[1] ? each : most,
  );
  return `${part} ${(value * 100).toFixed(2)}%`;
}

/** One measurement as one line of a table, for a person reading test output. */
export function measurementLine(measurement: Measurement): string {
  const cell = (value: string, width: number): string => value.padStart(width);
  return [
    cell(measurement.label, 8),
    cell(`${String(measurement.bytes)} B`, 10),
    cell(`block ${String(measurement.blockHeight)}`, 10),
    cell(`prove ${measurement.provingSeconds.toFixed(1)} s`, 13),
    cell(`balance ${measurement.balancingSeconds.toFixed(1)} s`, 15),
    cell(`final ${measurement.submitToFinalSeconds.toFixed(1)} s`, 13),
    cell(`fee ${String(measurement.fees)}`, 22),
    `read ${String(measurement.cost.readTime)} ps, compute ${String(measurement.cost.computeTime)} ps, ` +
      `block ${String(measurement.cost.blockUsage)} B, written ${String(measurement.cost.bytesWritten)} B, ` +
      `churned ${String(measurement.cost.bytesChurned)} B`,
    `largest share of a block ${largestShare(measurement.blockShare)}`,
  ].join(' | ');
}
