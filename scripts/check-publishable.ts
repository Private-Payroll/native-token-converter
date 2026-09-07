// SPDX-License-Identifier: Apache-2.0

/**
 * Refuses unless this tree is exactly what the repository publishes.
 *
 * Three questions, and the first two are the same question asked both ways:
 *
 *  - is anything here that src/publishable.ts does not name?
 *  - is anything named there missing from here?
 *  - do that list and .gitignore still agree about what stays behind?
 *
 * Then, over the published files themselves, whether any of them says
 * something that belongs to how the work was done rather than to the software.
 * Half of that reading needs a list of words which is deliberately not in this
 * repository: pass `--vocabulary <file>` where that file is, and the whole
 * reading runs. Without it the two rules that name nothing still run, which is
 * what the workflow can do on a published checkout.
 *
 * `--tracked <file>` reads a list of the paths git is tracking, one per line,
 * and compares it with the same publish list in both directions. This is the
 * question the walk cannot ask: the walk answers `local` for a file meant to
 * stay on this machine, which is right about the tree and says nothing about
 * whether that file has found its way into the repository.
 *
 * `--list` prints the published files, one per line, and nothing else, so the
 * step that stages a commit can stage exactly them rather than whatever the
 * tree happens to hold.
 *
 * The judgement is in src/publishable.ts and src/vocabulary.ts; this walks the
 * tree, reads the files, and reports.
 */

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  GENERATED,
  ignoreDisagreements,
  matchesPattern,
  PUBLISHED,
  publishRefusals,
  trackedRefusals,
} from '../src/publishable.js';
import {
  parseVocabulary,
  saidPlainly,
  whatMustNotBePublished,
  type Vocabulary,
} from '../src/vocabulary.js';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Git's own directory. It is on none of the lists because git never tracks it,
 * so .gitignore has no reason to name it and neither has the publish list.
 */
const GIT = '.git';

function isGenerated(path: string): boolean {
  return GENERATED.some((pattern) => matchesPattern(pattern, path));
}

/** Paths in the tree that are links rather than files. */
const links: string[] = [];

/** Every file in the tree, as a path from the top, generated ones left out. */
function filesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    const path = relative(ROOT, full);
    // Read with `lstat` rather than `stat`, so a link is a link. git commits
    // the text a link points at rather than the file it reaches, so a scanner
    // that follows one reads something other than what would be published.
    const what = lstatSync(full);
    // What is generated and what git keeps to itself are answered first, so a
    // `node_modules` that is itself a link, and a `.git` that is a file rather
    // than a directory, are left alone rather than refused.
    if (entry === GIT || isGenerated(path) || isGenerated(`${path}/`)) {
      continue;
    }
    if (what.isSymbolicLink()) {
      found.push(path);
      links.push(path);
    } else if (what.isDirectory()) {
      found.push(...filesUnder(full));
    } else {
      found.push(path);
    }
  }
  return found;
}

function vocabularyFrom(path: string): Vocabulary {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `there is no list of what must not ship at ${path}. It is not in this repository on purpose: a list of words a repository forbids is a document containing every one of them.`,
    );
  }
  return parseVocabulary(JSON.parse(text));
}

const args = process.argv.slice(2);
const listOnly = args.includes('--list');

function valueOf(flag: string): string | undefined {
  const at = args.indexOf(flag);
  if (at === -1) {
    return undefined;
  }
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`${flag} names the file it applies to`);
    process.exit(2);
  }
  return value;
}

const trackedAt = valueOf('--tracked');
const at = args.indexOf('--vocabulary');
if (at !== -1 && args[at + 1] === undefined) {
  console.error('--vocabulary names the file holding the list');
  process.exit(2);
}

let vocabulary: Vocabulary | undefined;
if (at !== -1) {
  try {
    vocabulary = vocabularyFrom(resolve(args[at + 1] as string));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

let refused = 0;
const say = (line: string): void => {
  console.error(line);
  refused += 1;
};

for (const refusal of publishRefusals(filesUnder(ROOT), links)) {
  say(`${refusal.path}  is ${refusal.reason}`);
}

for (const disagreement of ignoreDisagreements(readFileSync(join(ROOT, '.gitignore'), 'utf8'))) {
  say(disagreement);
}

if (trackedAt !== undefined) {
  const tracked = readFileSync(trackedAt, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  for (const refusal of trackedRefusals(tracked)) {
    say(`${refusal.path}  is ${refusal.reason}`);
  }
}

for (const path of PUBLISHED) {
  let text: string;
  try {
    text = readFileSync(join(ROOT, path), 'utf8');
  } catch (error) {
    // Not the missing case, which is already refused above. This is a file
    // that is there and could not be opened, and it would otherwise be
    // committed by name with none of the reading below ever having run on it.
    say(`${path}  is published and could not be read: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  for (const occurrence of whatMustNotBePublished(text, vocabulary)) {
    say(`${path}:${occurrence.line}  ${saidPlainly(occurrence)}`);
  }
}

if (refused > 0) {
  console.error(
    `\n${refused} thing(s) stop this being published. Name the file on the list if it should ship, take it out of the tree if it should not, and say the rest in the software's own words.`,
  );
  process.exit(1);
}

if (listOnly) {
  for (const path of PUBLISHED) {
    console.log(path);
  }
} else {
  console.log(
    vocabulary === undefined
      ? `Every one of the ${PUBLISHED.length} published files is named, present${trackedAt === undefined ? '' : ', tracked'}, and carries nothing that must not be seen and no address that must not be published. The list of words was not read: it is not in this repository.`
      : `Every one of the ${PUBLISHED.length} published files is named, present${trackedAt === undefined ? '' : ', tracked'}, and clear of the ${vocabulary.terms.length} things that must not ship.`,
  );
}
