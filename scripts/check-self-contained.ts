// SPDX-License-Identifier: Apache-2.0

/**
 * Refuses if any published file points somewhere a reader cannot follow.
 *
 * What counts as published is src/publishable.ts's answer rather than a guess
 * from a file extension: a reader of this repository never opens a file that
 * is not published, so a citation in one is nobody's to follow.
 *
 * The judgement is in src/self-contained.ts; this walks the tree, resolves what
 * each file points at, and reports.
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { PUBLISHED, standingOf } from '../src/publishable.js';
import { unfollowableCitations } from '../src/self-contained.js';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Directories that are not published, or are not this repository's text.
 * `managed` is what the compiler writes; a citation INTO it is still checked,
 * because a path either resolves on disk or it does not.
 */
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'managed', '.compactc']);

/**
 * Files this check does not read, each for its own reason.
 *
 * - The lock file is written by the package manager and the paths in it belong
 *   to other people's packages.
 * - The two tests that define what a path a reader cannot follow looks like
 *   have to be able to show one, so their examples are deliberately broken.
 */
const SKIP_FILES = new Set([
  'package-lock.json',
  'test/self-contained.test.ts',
  'test/publishable.test.ts',
]);

function filesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    // Read without following a link, so a broken one does not throw out of this
    // and a loop of them does not run for ever. A link is never read: the
    // publish check refuses one outright, and this runs before it.
    const what = lstatSync(full);
    if (what.isSymbolicLink()) {
      continue;
    }
    if (what.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry)) {
        found.push(...filesUnder(full));
      }
    } else if (
      standingOf(relative(ROOT, full)) === 'published' &&
      !SKIP_FILES.has(relative(ROOT, full))
    ) {
      found.push(full);
    }
  }
  return found;
}

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
 * is enough: prose says `src/index.ts` and code says `../src/index.js`, and both
 * are followable.
 */
function resolvesFrom(file: string, cited: string): boolean {
  return present(resolve(dirname(file), cited)) || present(resolve(ROOT, cited));
}

let unfollowable = 0;
for (const file of filesUnder(ROOT)) {
  const where = relative(ROOT, file);
  const citations = unfollowableCitations(readFileSync(file, 'utf8'), (cited) =>
    resolvesFrom(file, cited),
  );
  for (const citation of citations) {
    const why =
      citation.reason === 'missing'
        ? 'is not in this repository'
        : 'is a local helper script and is not published';
    console.error(`${where}:${citation.line}  ${citation.text} ${why}`);
    unfollowable += 1;
  }
}

if (unfollowable > 0) {
  console.error(
    `\n${unfollowable} citation(s) a reader could not follow. Point at something that ships, or say it in words.`,
  );
  process.exit(1);
}
const read = filesUnder(ROOT).length;
console.log(
  `Every path cited by the ${read} published files this read is in the repository. The other ${PUBLISHED.length - read} were not read, for the reasons written above them.`,
);
