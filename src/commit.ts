// SPDX-License-Identifier: Apache-2.0

/**
 * What a change to this repository is called.
 *
 * A commit here is read by people who were not in the room, so the subject line
 * has to say what changed without any of the context that produced it. The same
 * rule applies to a pull request title, because a squashed merge makes the title
 * the subject, and to a branch name, which stays on the pull request page after
 * the branch itself is gone.
 *
 * All three are permanent. A file can be corrected by the next commit; a commit
 * message cannot be corrected by anything. So the reading happens before the
 * writing, and it refuses rather than warns.
 *
 * What each one is allowed to say is here. What none of them may say is in
 * src/vocabulary.ts, half of it as shapes that can be published and half of it
 * as a list that cannot.
 */

import { saidPlainly, whatMustNotBePublished, type Vocabulary } from './vocabulary.js';

/** The kinds of change, and nothing else. */
export const KINDS = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'test',
] as const;

/** Long enough to say what changed; short enough to read in a log. */
export const SUBJECT_LIMIT = 72;

/**
 * Long enough for the words `branchFor` keeps, and a limit at all because a
 * branch name is a path on several filesystems before it is a name on a page.
 */
export const BRANCH_LIMIT = 60;

const SUBJECT = new RegExp(`^(${KINDS.join('|')})(\\([a-z0-9-]+\\))?: (.+)$`);

const BRANCH = new RegExp(`^(${KINDS.join('|')})\\/[a-z0-9]+(-[a-z0-9]+)*$`);

/**
 * The first thing in `text` that must not be published, or null if there is
 * nothing. Shared by all three, because all three are read by the same people
 * in the same place.
 *
 * All three are read without regard to case, whatever a term asks for
 * elsewhere. The reason is the rules above: a subject line is refused if it is
 * capitalised after the colon, and a branch name is refused unless it is lower
 * case throughout, so anything written in capitals in prose arrives on these
 * surfaces in lower case and a term matched exactly would never see it. What
 * that costs here was measured on this repository and is nothing: read this
 * way, the terms refuse a hundred and forty things, a hundred and forty-one of
 * them in files written by tools rather than by people, and none at all in
 * anything a person wrote.
 */
function nothingUnpublishable(
  text: string,
  vocabulary: Vocabulary | undefined,
  lead = 'this says something about the work rather than about the change',
): string | null {
  const [first] = whatMustNotBePublished(text, vocabulary, { ignoreCase: true });
  if (first === undefined) {
    return null;
  }
  return `${lead}: ${saidPlainly(first)}`;
}

/**
 * What is wrong with a subject line, or null if nothing is.
 *
 * Counted in characters rather than bytes, so a subject that reads as 72
 * characters is accepted whatever alphabet it is written in.
 */
export function subjectProblem(subject: string, vocabulary?: Vocabulary): string | null {
  if (subject.trim() === '') {
    return 'a subject line has to say what the change does';
  }
  const length = [...subject].length;
  if (length > SUBJECT_LIMIT) {
    return `a subject line is at most ${SUBJECT_LIMIT} characters, and this one is ${length}`;
  }
  const parts = SUBJECT.exec(subject);
  if (parts === null) {
    return `a subject line reads "kind: what changed", where kind is one of ${KINDS.join(', ')}`;
  }
  const description = parts[3] ?? '';
  if (description.endsWith('.')) {
    return 'a subject line does not end with a full stop';
  }
  if (description[0] !== description[0]?.toLowerCase()) {
    return 'a subject line is not capitalised after the colon';
  }
  return nothingUnpublishable(subject, vocabulary);
}

/**
 * The branch a change with this subject belongs on.
 *
 * Derived rather than asked for, so a branch name describes the change and
 * cannot come to describe anything else.
 */
export function branchFor(subject: string): string {
  const problem = subjectProblem(subject);
  if (problem !== null) {
    throw new Error(problem);
  }
  const parts = SUBJECT.exec(subject);
  const kind = parts?.[1] ?? '';
  const words = (parts?.[3] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter((word) => word !== '');
  const kept: string[] = [];
  for (const word of words) {
    if ([...kept, word].join('-').length > 40) {
      break;
    }
    kept.push(word);
  }
  return `${kind}/${kept.join('-')}`;
}

/**
 * What is wrong with a branch name, or null if nothing is.
 *
 * A branch name derived from a subject satisfies this by construction. It is
 * checked anyway, and checked separately, because a branch can be created by
 * hand and the name survives the branch: it is on the pull request page for as
 * long as the pull request is.
 */
export function branchProblem(branch: string, vocabulary?: Vocabulary): string | null {
  if (branch.trim() === '') {
    return 'a branch name has to say what the change does';
  }
  if (branch.length > BRANCH_LIMIT) {
    return `a branch name is at most ${BRANCH_LIMIT} characters, and this one is ${branch.length}`;
  }
  if (!BRANCH.test(branch)) {
    return `a branch name reads "kind/what-changed" in lower case, where kind is one of ${KINDS.join(', ')}`;
  }
  return nothingUnpublishable(branch, vocabulary);
}

/**
 * What is wrong with the name a commit will be authored under, or null if
 * nothing is.
 *
 * The name is on every commit, on every line of blame and on every page that
 * shows one, and it is as permanent as the message. Held to the same rules
 * rather than to a list of acceptable names, because what must not appear is
 * the same thing here as anywhere else.
 */
export function authorProblem(name: string, vocabulary?: Vocabulary): string | null {
  if (name.trim() === '') {
    return 'a commit is authored under a name, and none is set';
  }
  return nothingUnpublishable(name, vocabulary, 'a name says who publishes this and nothing else');
}

/**
 * Lines that say who or what produced a change rather than what the change is.
 * This repository's history carries one author and no attributions.
 *
 * The shape is the rule rather than a list of the tools that write these,
 * because the list would be out of date by the time it was published and the
 * shape has not changed in twenty years.
 */
const ATTRIBUTION = /^([a-z]+(-[a-z]+)*-by:|generated (with|by)\b|authored (with|by)\b)/i;

/** The mark a tool leaves on a message it wrote part of. */
const TOOL_MARK = /[\u{1F916}\u{1F9BE}]/u;

/**
 * What is wrong with a whole commit message, or null if nothing is.
 *
 * A squashed merge makes a pull request body the commit body, so the workflow
 * puts the title and the body through this same function as the message they
 * are about to become. One set of rules rather than two that could drift.
 */
export function messageProblem(message: string, vocabulary?: Vocabulary): string | null {
  const lines = message.replace(/\s+$/, '').split('\n');
  const problem = subjectProblem(lines[0] ?? '', vocabulary);
  if (problem !== null) {
    return problem;
  }
  if (lines.length > 1 && (lines[1] ?? '') !== '') {
    return 'a blank line separates the subject from the body';
  }
  for (const line of lines) {
    if (ATTRIBUTION.test(line.trim())) {
      return `a commit message says what changed, not who changed it: ${JSON.stringify(line.trim())}`;
    }
    if (TOOL_MARK.test(line)) {
      return `a commit message says what changed, not what wrote it: ${JSON.stringify(line.trim())}`;
    }
  }
  return nothingUnpublishable(message, vocabulary);
}
