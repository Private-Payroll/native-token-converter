// SPDX-License-Identifier: Apache-2.0

/**
 * THE CHECK EVERY PULL REQUEST RUNS ON ITS TITLE.
 *
 * .github/workflows/ci.yml runs this file on every pull request, on the title
 * and on the branch name. A squashed merge makes the title the commit subject
 * and the body the commit body, so the title a pull request is opened with is
 * the message that ends up in the history. Reading it here is reading it
 * before it is permanent, which is the only time it can be read at all.
 *
 * The same file reads a commit message from disk before a commit is made, so
 * there is one set of rules rather than two that could drift apart.
 *
 * It prints the branch the change belongs on, or says what is wrong and
 * refuses.
 *
 *   commit-check.ts <file> [--vocabulary <file>] [--branch <name>] [--author <name>]
 *
 * `--vocabulary` names a list of what must not be published that is not in
 * this repository, for the reason given in src/vocabulary.ts. Without it the
 * rules that name nothing still run, which is what a pull request can check.
 *
 * The judgement is in src/commit.ts and src/vocabulary.ts; this reads a file
 * and reports.
 */

import { readFileSync } from 'node:fs';
import { authorProblem, branchFor, branchProblem, messageProblem } from '../src/commit.js';
import { parseVocabulary, type Vocabulary } from '../src/vocabulary.js';

function valueOf(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  if (at === -1) {
    return undefined;
  }
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`${flag} names what it applies to`);
    process.exit(2);
  }
  return value;
}

const args = process.argv.slice(2);
const path = args[0];
if (path === undefined || path.startsWith('--')) {
  console.error('name the file holding the message');
  process.exit(2);
}

const listedAt = valueOf(args, '--vocabulary');
let vocabulary: Vocabulary | undefined;
if (listedAt !== undefined) {
  try {
    vocabulary = parseVocabulary(JSON.parse(readFileSync(listedAt, 'utf8')));
  } catch (error) {
    console.error(
      `${listedAt}\n  ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  }
}

const message = readFileSync(path, 'utf8');
const problem = messageProblem(message, vocabulary);
if (problem !== null) {
  console.error(`${path}\n  ${problem}`);
  process.exit(1);
}

const subject = message.split('\n')[0] ?? '';
const derived = branchFor(subject);

const author = valueOf(args, '--author');
if (author !== undefined) {
  const wrong = authorProblem(author, vocabulary);
  if (wrong !== null) {
    console.error(`${author}\n  ${wrong}`);
    process.exit(1);
  }
}

const named = valueOf(args, '--branch');
for (const branch of named === undefined ? [derived] : [derived, named]) {
  const wrong = branchProblem(branch, vocabulary);
  if (wrong !== null) {
    console.error(`${branch}\n  ${wrong}`);
    process.exit(1);
  }
}

if (vocabulary === undefined) {
  console.error(
    'Read for a dash, for a character nobody can see, for an address, for a trailer and for the mark a tool leaves. The list of words was not read: it is not in this repository.',
  );
}
console.log(derived);
