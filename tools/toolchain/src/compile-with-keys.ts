// SPDX-License-Identifier: Apache-2.0

/**
 * Compiles every contract in the repository with proving and verifier keys,
 * each into its own workspace's build folder, and writes a manifest beside
 * each build. Where the builds go and what a manifest records is in
 * keyed-builds.ts; the compiler is the pinned one, and any other is refused
 * before anything is built. The builds without keys that the contract tests
 * read are left as they are. Last, the converter's ownerless deploy state is
 * built from its fresh build and refused unless it is the one the library
 * releases, so every machine that builds it is compared with the same keys.
 */

import { writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { join, relative, resolve } from 'node:path';
import type { Constructible } from '../../../packages/library/src/deploy-state.js';
import {
  converterDeployState,
  converterProblems,
} from '../../../packages/library/src/released-converter.js';
import { compileContract } from './compiler.js';
import {
  CONVERTER,
  buildManifest,
  contractSources,
  keyedBuildDirectory,
  manifestPath,
  importCompiledModule,
  manifestText,
  verifierKeys,
} from './keyed-builds.js';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

const sources = contractSources(ROOT);
if (sources.length === 0) {
  throw new Error(`there is no contracts/*/src/*.compact under ${ROOT} to compile`);
}
for (const { workspace, name, source } of sources) {
  const directory = keyedBuildDirectory(workspace, name);
  console.log(`compiling ${relative(ROOT, source)} with keys into ${relative(ROOT, directory)}`);
  const compiler = compileContract(source, directory, { withProvingKeys: true });
  const manifest = buildManifest(directory, {
    contract: relative(ROOT, source),
    compiler,
    platform: platform(),
    arch: arch(),
  });
  writeFileSync(manifestPath(workspace, name), manifestText(manifest));
}
console.log(`compiled ${String(sources.length)} contracts with keys, each with its manifest`);

// The converter just built, as its ownerless deploy state, compared with the
// one the library releases: a machine whose build differs stops here.
const converterBuild = keyedBuildDirectory(join(ROOT, CONVERTER.workspace), CONVERTER.name);
const generated = await importCompiledModule<{
  Contract: new (witnesses: Record<string, never>) => Constructible<undefined>;
}>(converterBuild);
const state = await converterDeployState(new generated.Contract({}), verifierKeys(converterBuild));
const problems = await converterProblems(state.serialize());
if (problems.length > 0) {
  throw new Error(
    `the converter built here is not the one the library releases: ${problems.join('; ')}. ` +
      'Either the source, the compiler or this machine differs; a new version of the converter is ' +
      'released as a new entry in the library, never by editing a released one.',
  );
}
console.log('the converter built here is the one the library releases');
