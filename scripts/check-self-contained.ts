// SPDX-License-Identifier: Apache-2.0

/**
 * Refuses if any file in this repository points somewhere a reader cannot
 * follow.
 *
 * The files read are scripts/repository-files.ts's answer: everything in the
 * folder that `.gitignore` does not name. The judgement is in
 * scripts/self-contained.ts; this resolves what each file points at, and
 * reports.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { repositoryFiles } from './repository-files.js';
import { unfollowableCitations } from './self-contained.js';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Files this check does not read, each for its own reason.
 *
 * - The lock file is written by the package manager and the paths in it belong
 *   to other people's packages.
 * - The test that defines what a path a reader cannot follow looks like has to
 *   be able to show one, so its examples are deliberately broken.
 */
const SKIP_FILES = new Set(['package-lock.json', 'test/self-contained.test.ts']);

function present(path: string): boolean {
  if (existsSync(path)) {
    return true;
  }
  // A source file names a sibling with a `.js` extension even though the file
  // on disk ends in `.ts`.
  return path.endsWith('.js') && existsSync(`${path.slice(0, -3)}.ts`);
}

/**
 * A citation written in `file` points either beside that file or, when it is
 * written without a leading dot, from the top of the repository. Either resolving
 * is enough: prose says `scripts/self-contained.ts` and code says `./self-contained.js`, and both
 * are followable.
 */
function resolvesFrom(file: string, cited: string): boolean {
  return present(resolve(dirname(file), cited)) || present(resolve(ROOT, cited));
}

const files = repositoryFiles(ROOT);
const read = files.filter((path) => !SKIP_FILES.has(path));
let unfollowable = 0;
for (const where of read) {
  const file = join(ROOT, where);
  const citations = unfollowableCitations(readFileSync(file, 'utf8'), (cited) =>
    resolvesFrom(file, cited),
  );
  for (const citation of citations) {
    console.error(`${where}:${citation.line}  ${citation.text} is not in this repository`);
    unfollowable += 1;
  }
}

if (unfollowable > 0) {
  console.error(
    `\n${unfollowable} citation(s) a reader could not follow. Point at something in this repository, or say it in words.`,
  );
  process.exit(1);
}
console.log(
  `Every path cited by the ${read.length} files this read is in the repository. The other ${files.length - read.length} were not read, for the reasons written above them.`,
);
