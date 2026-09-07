// SPDX-License-Identifier: Apache-2.0

/**
 * A claim this repository has retracted, and the place it keeps arriving from.
 *
 * The token module this contract is built on carries a notice saying that a
 * coin a contract mints cannot be found by its owner, that the value the
 * circuit returns is the only copy of it, and that losing that value loses the
 * money. That is written for a mint to a contract address. It is not true of a
 * mint to a person's key, which is the only kind `wrap` can make, and it has
 * been copied out of that module into this repository's own prose twice.
 *
 * Twice is a habit rather than an accident, and it is easy to see why: the
 * notice sits directly above the circuit anybody reading this contract goes to
 * read, it is stated as fact, and it is about money. A reader who takes it at
 * face value writes it down again. Nothing here can edit somebody else's
 * module, so the only thing that can stop a third copy is a check on the way
 * out.
 *
 * The rule is derived rather than written down. Guessing at the words a future
 * author might use would pin a phrasing and miss the paste; instead the notices
 * are read out of the module itself, at the version this repository pins, and a
 * file that reproduces a run of one is refused. The wording that is refused is
 * therefore always the wording that is actually there.
 *
 * That has a consequence worth stating rather than discovering: this cannot see
 * somebody reasoning their way to the same conclusion in their own words, which
 * is how the claim arrived the first time. It catches copying, not believing.
 * The comment in the contract is what addresses the other half.
 *
 * The rules live here, apart from the walk over the tree, so they can be tested
 * against text that is not on disk.
 */

/** One notice in the module, and where it is. */
export interface Notice {
  readonly source: string;
  readonly line: number;
  readonly text: string;
}

/** One place a file reproduces a notice, and the run of words that gave it away. */
export interface Reproduction {
  readonly path: string;
  readonly line: number;
  readonly words: string;
  readonly source: string;
}

/**
 * How much of a notice has to be reproduced before it counts.
 *
 * Six words is long enough that ordinary prose about a shielded coin does not
 * reach it by coincidence: measured over every file this repository publishes,
 * nothing but the two known copies did. It is short enough to survive the
 * editing a paste picks up on arrival, which is what happened both times. A
 * plural dropped, a verb swapped, and whole clauses still word for word
 * underneath.
 *
 * The examples that would make that concrete are deliberately not written out.
 * This file is read by the check it defines, and the first draft of this
 * paragraph quoted the module to illustrate the point and was refused by it.
 * That is not an awkwardness to work around: a guard spelled out in the words
 * it forbids has published them in the act of forbidding them, which is the
 * same reason the list of words this repository will not commit is kept
 * outside it.
 */
export const RUN_LENGTH = 6;

/**
 * How a notice is recognised in the module.
 *
 * Two fragments, both of which a notice has to contain. One names the claim
 * about the returned value, the other the claim about the chain, and it is the
 * pair that makes the claim what it is: either alone appears in prose that is
 * about something else entirely.
 *
 * These are fragments of the text as it stands at the pinned version, which is
 * a thing this file can be sure of because that version is in the lock file.
 * They are not a prediction about how anybody will word it in future, and
 * nothing here relies on them staying accurate: if the module is reworded, they
 * stop matching, the count below stops holding, and a test says so.
 */
export const NOTICE_MARKERS: readonly string[] = ['only cop', 'scanning the chain'];

/**
 * How many notices the pinned module carries, which is checked rather than
 * assumed.
 *
 * This is the guard on the guard. Everything above reads a corpus out of a
 * directory that is not in this repository and is replaced wholesale by an
 * install, so the way this check fails without anybody noticing is by finding
 * nothing to check: a rename upstream, a reworded notice, a version bump, an
 * install that did not happen, and the walk goes quietly green over an empty
 * corpus while the claim it exists to catch walks straight past.
 *
 * So the count is pinned. A change to it is not a failure of the module and not
 * a defect in this repository; it is the one moment when somebody has to open
 * those notices and read them again, which is exactly the moment this file
 * exists for.
 */
export const NOTICES_EXPECTED = 7;

/** The module files whose notices are read. */
export const NOTICE_SOURCES: readonly string[] = [
  'node_modules/@openzeppelin/compact-contracts/token/NativeShieldedToken.compact',
  'node_modules/@openzeppelin/compact-contracts/token/NativeShieldedTokenCore.compact',
  'node_modules/@openzeppelin/compact-contracts/token/NativeShieldedTokenFamily.compact',
];

/**
 * The words of a text, lower case, with everything that is not a letter or a
 * digit treated as a gap.
 *
 * Punctuation, backticks and capitals are what an editing hand changes first
 * and they carry none of the claim, so they are dropped before anything is
 * compared. Nothing is stemmed: a plural is a different word here, which costs
 * a little reach and buys a rule somebody can predict the behaviour of without
 * running it.
 */
export function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '');
}

function flattened(lines: readonly string[]): string {
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Every run of consecutive comment lines in a source file, flattened to one
 * string, with the line the run starts on.
 *
 * A claim is read across the lines it is wrapped over rather than line by line,
 * because a comment wrapped at seventy-odd columns puts a break in the middle
 * of most sentences worth reading, and the better it is written the more breaks
 * there are.
 */
export function commentRuns(text: string): { line: number; text: string }[] {
  const runs: { line: number; text: string }[] = [];
  let held: string[] = [];
  let start = 0;
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line.startsWith('*') || line.startsWith('/*') || line.startsWith('//')) {
      if (held.length === 0) {
        start = index + 1;
      }
      held.push(line.replace(/^(\/\*+|\*\/|\*|\/\/)/, ''));
      return;
    }
    if (held.length > 0) {
      runs.push({ line: start, text: flattened(held) });
      held = [];
    }
  });
  if (held.length > 0) {
    runs.push({ line: start, text: flattened(held) });
  }
  return runs;
}

/**
 * The retracted notices in one module file.
 *
 * A comment run is cut at each of its tags before the markers are looked for,
 * so what is kept is the notice and not the paragraphs either side of it. That
 * matters: the requirements listed under the same comment describe the burn's
 * check that a note belongs to the pool it came from, which this repository
 * says in its own words, correctly, and which would otherwise be refused for
 * agreeing with the module about something true.
 */
export function retractedNotices(source: string, text: string): Notice[] {
  const notices: Notice[] = [];
  for (const run of commentRuns(text)) {
    for (const clause of run.text.split(/(?=@[A-Za-z]+\b)/)) {
      const notice = clause.replace(/\s+/g, ' ').trim();
      const lowered = notice.toLowerCase();
      if (NOTICE_MARKERS.every((marker) => lowered.includes(marker))) {
        notices.push({ source, line: run.line, text: notice });
      }
    }
  }
  return notices;
}

/** Every run of `RUN_LENGTH` words that appears in any of `notices`. */
export function runsOf(notices: readonly Notice[]): Map<string, string> {
  const runs = new Map<string, string>();
  for (const notice of notices) {
    const words = significantWords(notice.text);
    for (let at = 0; at + RUN_LENGTH <= words.length; at += 1) {
      runs.set(words.slice(at, at + RUN_LENGTH).join(' '), notice.source);
    }
  }
  return runs;
}

/**
 * Where `text` reproduces one of `notices`, reported at the line the run starts
 * on and with the words that gave it away, so the reader is told what to look
 * for rather than that something somewhere is wrong.
 *
 * The whole file is read as one sequence of words for the same reason a comment
 * run is: a sentence copied into a README arrives wrapped, and a reading that
 * stops at each newline would miss most of one.
 */
export function reproductions(
  path: string,
  text: string,
  notices: readonly Notice[],
): Reproduction[] {
  const runs = runsOf(notices);
  const words: { word: string; line: number }[] = [];
  text.split('\n').forEach((line, index) => {
    for (const word of significantWords(line)) {
      words.push({ word, line: index + 1 });
    }
  });
  const found: Reproduction[] = [];
  const already = new Set<string>();
  for (let at = 0; at + RUN_LENGTH <= words.length; at += 1) {
    const run = words
      .slice(at, at + RUN_LENGTH)
      .map((held) => held.word)
      .join(' ');
    const source = runs.get(run);
    if (source !== undefined && !already.has(`${words[at]?.line}`)) {
      already.add(`${words[at]?.line}`);
      found.push({ path, line: words[at]?.line ?? 0, words: run, source });
    }
  }
  return found;
}
