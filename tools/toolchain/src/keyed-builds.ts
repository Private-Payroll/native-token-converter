// SPDX-License-Identifier: Apache-2.0

/**
 * Where each contract's build with proving and verifier keys goes, and the
 * manifest written beside it. Every `contracts/<workspace>/src/<Name>.compact`
 * is built into `contracts/<workspace>/managed-keys/<Name>/`, and
 * `<Name>.manifest.json` beside that folder records the compiler, the machine
 * and the digest of every verifier key and circuit file, so two machines'
 * builds can be compared file by file. Proving keys are not recorded: they are
 * large and are not what a deployed contract is checked against. Also here:
 * which build is the converter's, every circuit's verifier key in a build, and
 * the generated module a build holds. A test asking for a build that is not
 * there is refused, naming the command that makes it.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The folder in each contract workspace that its builds with keys go into. */
export const KEYED_BUILD_FOLDER = 'managed-keys';

/** The command that writes every build with keys. */
export const COMPILE_WITH_KEYS_COMMAND = 'npm run compile:keys';

/** The file extension of a circuit's verifier key in a build's `keys` folder. */
const VERIFIER = '.verifier';

/** Whether `file`, in a build's `keys` folder, is a circuit's verifier key. */
function isVerifierKey(file: string): boolean {
  return file.endsWith(VERIFIER);
}

/** One contract source, and the workspace it belongs to. */
export interface ContractSource {
  /** The workspace folder, absolute. */
  readonly workspace: string;
  /** The source file's name without `.compact`. */
  readonly name: string;
  /** The source file, absolute. */
  readonly source: string;
}

/** Every `contracts/*\/src/*.compact` under `root`, in a stable order. */
export function contractSources(root: string): ContractSource[] {
  const contracts = join(root, 'contracts');
  const found: ContractSource[] = [];
  for (const entry of readdirSync(contracts).sort()) {
    const sources = join(contracts, entry, 'src');
    if (!existsSync(sources)) {
      continue;
    }
    for (const file of readdirSync(sources).sort()) {
      if (file.endsWith('.compact')) {
        const name = file.slice(0, -'.compact'.length);
        found.push({ workspace: join(contracts, entry), name, source: join(sources, file) });
      }
    }
  }
  return found;
}

/** The folder a contract's build with keys goes into. */
export function keyedBuildDirectory(workspace: string, name: string): string {
  return join(workspace, KEYED_BUILD_FOLDER, name);
}

/** The manifest written beside that folder. */
export function manifestPath(workspace: string, name: string): string {
  return join(workspace, KEYED_BUILD_FOLDER, `${name}.manifest.json`);
}

/** What a build with keys was made from and what it holds, for comparing two machines' builds. */
export interface BuildManifest {
  /** The source, from the top of the repository. */
  readonly contract: string;
  readonly compiler: string;
  readonly platform: string;
  readonly arch: string;
  /** The SHA-256 of every verifier key and circuit file, by path inside the build. */
  readonly sha256: Readonly<Record<string, string>>;
}

/** Whether a file in a build is one the manifest records. */
export function isRecorded(path: string): boolean {
  return (path.startsWith('keys/') && isVerifierKey(path)) || path.startsWith('zkir/');
}

/** The manifest of the build in `directory`. */
export function buildManifest(
  directory: string,
  made: Omit<BuildManifest, 'sha256'>,
): BuildManifest {
  const sha256: Record<string, string> = {};
  for (const folder of ['keys', 'zkir']) {
    const at = join(directory, folder);
    if (!existsSync(at)) {
      continue;
    }
    for (const file of readdirSync(at).sort()) {
      const path = `${folder}/${file}`;
      if (isRecorded(path)) {
        sha256[path] = createHash('sha256')
          .update(readFileSync(join(at, file)))
          .digest('hex');
      }
    }
  }
  return { ...made, sha256 };
}

/** A manifest as it is written: two spaces, keys in the order above, a final newline. */
export function manifestText(manifest: BuildManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** The refusal for a build that is not there. */
export function missingBuild(directory: string, root: string): string {
  return (
    `there is no build with keys at ${relative(root, directory)}. ` +
    `Run ${COMPILE_WITH_KEYS_COMMAND} first; the tests read the builds and compile nothing.`
  );
}

/**
 * The build with keys of contract `name` in `workspace`, or a refusal naming
 * the command that writes it. A build counts as there once it holds the
 * generated module and a verifier key.
 */
export function keyedBuild(workspace: string, name: string): string {
  const directory = keyedBuildDirectory(workspace, name);
  const keys = join(directory, 'keys');
  const hasVerifier = existsSync(keys) && readdirSync(keys).some(isVerifierKey);
  if (!existsSync(join(directory, 'contract', 'index.js')) || !hasVerifier) {
    throw new Error(missingBuild(directory, join(workspace, '..', '..')));
  }
  return directory;
}

/** The converter's source, by the workspace and name its keyed build is found under. */
export const CONVERTER = {
  workspace: join('contracts', 'converter'),
  name: 'NativeTokenConverter',
};

/**
 * Every circuit's verifier key in the build at `directory`, by circuit name,
 * as the compiler wrote it. Empty when the build has no keys.
 */
export function verifierKeys(directory: string): Record<string, Uint8Array> {
  const at = join(directory, 'keys');
  if (!existsSync(at)) {
    return {};
  }
  const keys: Record<string, Uint8Array> = {};
  for (const file of readdirSync(at).sort()) {
    if (isVerifierKey(file)) {
      keys[file.slice(0, -VERIFIER.length)] = new Uint8Array(readFileSync(join(at, file)));
    }
  }
  return keys;
}

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
