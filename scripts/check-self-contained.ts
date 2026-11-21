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
import { dirname, join, relative, resolve, sep } from 'node:path';
import { ignoreRules, isIgnored, repositoryFiles } from './repository-files.js';
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

const IGNORED = ignoreRules(readFileSync(join(ROOT, '.gitignore'), 'utf8'));

/**
 * Whether `path` lies in a folder `.gitignore` names as generated, such as a
 * contract's build. What is there is written by a command of this repository,
 * so a citation of it is followable once that command has run, whether or not
 * it has run here.
 */
function generated(path: string): boolean {
  const inside = relative(ROOT, path);
  return !inside.startsWith('..') && isIgnored(IGNORED, inside.split(sep).join('/'), false);
}

/**
 * A citation written in `file` points either beside that file or, when it is
 * written without a leading dot, from the top of the repository. Either resolving
 * is enough: prose says `scripts/self-contained.ts` and code says `./self-contained.js`, and both
 * are followable.
 */
function resolvesFrom(file: string, cited: string): boolean {
  const beside = resolve(dirname(file), cited);
  return present(beside) || present(resolve(ROOT, cited)) || generated(beside);
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
    console.error(`${where}:${String(citation.line)}  ${citation.text} is not in this repository`);
    unfollowable += 1;
  }
}

if (unfollowable > 0) {
  console.error(
    `\n${String(unfollowable)} citation(s) a reader could not follow. Point at something in this repository, or say it in words.`,
  );
  process.exit(1);
}
console.log(
  `Every path cited by the ${String(read.length)} files this read is in the repository. The other ${String(files.length - read.length)} were not read, for the reasons written above them.`,
);
