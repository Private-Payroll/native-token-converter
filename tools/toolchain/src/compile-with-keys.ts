// SPDX-License-Identifier: Apache-2.0

/**
 * Compiles every contract in the repository with proving and verifier keys,
 * each into its own workspace's build folder, and writes a manifest beside
 * each build. Where the builds go and what a manifest records is in
 * keyed-builds.ts; the compiler is the pinned one, and any other is refused
 * before anything is built. The builds without keys that the contract tests
 * read are left as they are.
 */

import { writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { relative, resolve } from 'node:path';
import { compileContract } from './compiler.js';
import {
  buildManifest,
  contractSources,
  keyedBuildDirectory,
  manifestPath,
  manifestText,
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
