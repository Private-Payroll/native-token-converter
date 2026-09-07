// SPDX-License-Identifier: Apache-2.0

/**
 * What this repository publishes, named one file at a time.
 *
 * The usual way round is a list of what must not ship, and it fails towards
 * publishing: a file nobody thought of is published by default, and a public
 * history cannot be taken back. So this list runs the other way. A file is
 * published because it is named here; a file that is not named stops the
 * publish until somebody decides which it is.
 *
 * The list is read in both directions. A file present and not named is the
 * obvious failure. A file named and not present is the quiet one, and it is
 * the one that matters more: that is how a list stops describing the tree
 * while still passing everything put to it.
 *
 * The rules live here, apart from the walk over the tree, so they can be
 * tested against names that are not on disk.
 */

/** Every file this repository publishes. Nothing else is published. */
export const PUBLISHED: readonly string[] = [
  '.github/workflows/ci.yml',
  '.gitignore',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'contracts/src/NativeTokenConverter.compact',
  'package-lock.json',
  'package.json',
  'scripts/check-publishable.ts',
  'scripts/check-self-contained.ts',
  'scripts/commit-check.ts',
  'scripts/compile.ts',
  'src/commit.ts',
  'src/index.ts',
  'src/publishable.ts',
  'src/self-contained.ts',
  'src/toolchain.ts',
  'src/vocabulary.ts',
  'src/wrapped-colour.ts',
  'test/commit.test.ts',
  'test/contract.test.ts',
  'test/converter.test.ts',
  'test/publishable.test.ts',
  'test/self-contained.test.ts',
  'test/toolchain.test.ts',
  'test/vocabulary.test.ts',
  'test/wrapped-colour.test.ts',
  'tsconfig.json',
  'vitest.config.ts',
];

/**
 * Written here by hand and kept on the machine that wrote it.
 *
 * These are not accidents and not leftovers. A double-clickable script names
 * one remote and one person's habits; a commit message is a draft until it is
 * a commit; the report a publish leaves behind is a record of one run. Each is
 * expected to be here and expected never to ship, so the walk has to be able
 * to tell them apart from a file nobody has classified.
 *
 * A name carrying `.local.` is the marker for the same thing in a file the
 * software reads: it stays on this machine whatever it is called.
 */
export const LOCAL_ONLY: readonly string[] = [
  '*.command',
  '*.local.json',
  '*.local.md',
  '*.local.test.ts',
  'COMMIT-MESSAGE.md',
  'REPORT-*.txt',
];

/**
 * Written by a tool rather than by a person, so there is nothing to publish:
 * running the tool again produces it.
 */
export const GENERATED: readonly string[] = [
  '.DS_Store',
  '.compactc/',
  '*.tsbuildinfo',
  'contracts/managed/',
  'node_modules/',
];

/** What the list says a file is. */
export type Standing = 'published' | 'local' | 'generated' | 'unnamed';

/** One reason a publish stops, and the file it stops on. */
export interface Refusal {
  readonly path: string;
  readonly reason:
    | 'present and not named'
    | 'named and not present'
    | 'named twice'
    | 'present as a link rather than a file'
    | 'tracked and not named'
    | 'named and not tracked';
}

/**
 * Whether a pattern covers a path.
 *
 * A pattern ending in `/` is a directory and covers everything under it. A
 * pattern with no `/` in it is matched against the file's own name at any
 * depth, the way a person means it when they write `*.command`. Anything else
 * is matched against the whole path. A `*` stands for any run of characters
 * within one segment, and never for a `/`.
 */
export function matchesPattern(pattern: string, path: string): boolean {
  if (pattern.endsWith('/')) {
    return path === pattern.slice(0, -1) || path.startsWith(pattern);
  }
  const target = pattern.includes('/') ? path : (path.split('/').pop() ?? path);
  const body = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${body}$`).test(target);
}

function coveredBy(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => matchesPattern(pattern, path));
}

/** Three lists, so the order they are read in can be shown rather than assumed. */
export interface Lists {
  readonly published: readonly string[];
  readonly local: readonly string[];
  readonly generated: readonly string[];
}

/** The three lists this repository actually keeps. */
export const LISTS: Lists = {
  published: PUBLISHED,
  local: LOCAL_ONLY,
  generated: GENERATED,
};

/**
 * What a set of lists says about one path.
 *
 * The order is the rule. A path that is both published and kept local is
 * answered `local`, so the safe reading wins while somebody sorts it out, and
 * the lists are taken as an argument so that a path on two of them can be put
 * to this and the answer watched. With the real lists no path is on two, which
 * would leave the order untested and therefore free to be reversed by anybody.
 *
 * The disagreement is not swallowed either: `publishRefusals` reports a path
 * on two lists as a defect in the lists themselves.
 */
export function standingIn(path: string, lists: Lists): Standing {
  if (coveredBy(lists.local, path)) {
    return 'local';
  }
  if (lists.published.includes(path)) {
    return 'published';
  }
  if (coveredBy(lists.generated, path)) {
    return 'generated';
  }
  return 'unnamed';
}

/** What this repository's own lists say about one path. */
export function standingOf(path: string): Standing {
  return standingIn(path, LISTS);
}

/**
 * Everything wrong with a tree whose files are `found`, written as paths from
 * the top of the repository. An empty result is a tree that is exactly what
 * this repository publishes.
 *
 * A file the list keeps local is not required to be present: the workflow
 * checks out the published files alone, and every one of these is absent
 * there. A published file is required to be present everywhere.
 *
 * `links` are the paths in `found` that are links rather than files, and every
 * one of them is refused whatever the lists say. git commits the text a link
 * points at rather than the file it reaches, so a link that is published sends
 * a reader somewhere that is not in the repository, and anything reading the
 * tree reads the wrong thing while agreeing with itself.
 */
export function publishRefusals(
  found: readonly string[],
  links: readonly string[] = [],
): Refusal[] {
  const refusals: Refusal[] = [];
  for (const path of links) {
    refusals.push({ path, reason: 'present as a link rather than a file' });
  }
  for (const path of PUBLISHED) {
    if (coveredBy(LOCAL_ONLY, path) || coveredBy(GENERATED, path)) {
      refusals.push({ path, reason: 'named twice' });
    }
  }
  for (const path of found) {
    if (standingOf(path) === 'unnamed') {
      refusals.push({ path, reason: 'present and not named' });
    }
  }
  const present = new Set(found);
  for (const path of PUBLISHED) {
    if (!present.has(path)) {
      refusals.push({ path, reason: 'named and not present' });
    }
  }
  return refusals;
}

/**
 * Everything wrong with the set of paths a commit would carry.
 *
 * The walk over the tree answers a different question from this one, and the
 * difference is where the whole design would otherwise fail silently. The walk
 * asks what is HERE, and it answers `local` for a file that is meant to stay on
 * this machine: not refused, because it is meant to be here. This asks what is
 * TRACKED, where the same file is a defect, because a file that stays on the
 * machine is one that is never committed.
 *
 * A file becomes tracked without anybody deciding to publish it more easily
 * than it sounds: a forced add, a rename out from under the pattern that held
 * it back, an edit to the pattern itself. From that moment the walk is green,
 * the tree is unchanged, and the file is in the repository.
 */
export function trackedRefusals(tracked: readonly string[]): Refusal[] {
  const refusals: Refusal[] = [];
  for (const path of tracked) {
    if (!PUBLISHED.includes(path)) {
      refusals.push({ path, reason: 'tracked and not named' });
    }
  }
  for (const path of PUBLISHED) {
    if (!tracked.includes(path)) {
      refusals.push({ path, reason: 'named and not tracked' });
    }
  }
  return refusals;
}

/**
 * Where the two lists have stopped agreeing.
 *
 * Everything this list keeps local or calls generated has to be ignored by
 * git as well, or a publish would carry it whatever this list says; and
 * anything git ignores has to be accounted for here, or a file could stop
 * being published without anybody deciding that. `.git` itself is on neither
 * list: git never tracks it, so nothing has to say so.
 */
export function ignoreDisagreements(gitignore: string): string[] {
  const ignored = new Set(
    gitignore
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#')),
  );
  const expected = new Set([...LOCAL_ONLY, ...GENERATED]);
  const problems: string[] = [];
  for (const pattern of [...expected].sort()) {
    if (!ignored.has(pattern)) {
      problems.push(`${pattern} is not published, and .gitignore does not say so`);
    }
  }
  for (const pattern of [...ignored].sort()) {
    if (!expected.has(pattern)) {
      problems.push(`.gitignore holds back ${pattern}, and this list does not account for it`);
    }
  }
  return problems;
}
