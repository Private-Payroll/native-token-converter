// SPDX-License-Identifier: Apache-2.0

/**
 * Every file this repository holds: the folder, less any directory named
 * `.git` and whatever `.gitignore` names. The checks over this repository's text read this
 * list, so a file added anywhere is read by them without being named, and a
 * generated path is written in one place, the ignore file.
 *
 * Only the ignore shapes this repository uses are understood: a name, a path
 * with a slash in it, `*` within one segment, and a trailing slash for a
 * directory. Any other shape refuses rather than guessing, because a guess that
 * ignores too much leaves a file unread by every check. A symbolic link refuses
 * as well: what it points at is not in the repository.
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One line of an ignore file, ready to match a path. */
export interface IgnoreRule {
  readonly source: string;
  readonly pattern: RegExp;
  readonly anchored: boolean;
  readonly directoryOnly: boolean;
}

/** What a shape outside the understood set looks like, and what it is. */
const UNDERSTOOD_NOT = [
  { shape: /^\s/, what: 'a rule starting with a space, which git reads as part of the name' },
  { shape: /^!/, what: 'a negation' },
  { shape: /\*\*/, what: 'a double star' },
  { shape: /[?[\]\\]/, what: 'a wildcard character or an escape' },
];

/**
 * The regular expression for one rule's glob. Every character a regular
 * expression treats as special is escaped first, so the glob's own characters
 * are matched literally; then each star, now escaped, becomes "anything within
 * one segment".
 */
export function toPattern(glob: string): RegExp {
  const literal = glob.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
  return new RegExp(`^${literal.replace(/\\\*/g, '[^/]*')}$`);
}

/**
 * The rules an ignore file's text holds, in order. Blank lines and comments
 * hold none. Throws on a shape this reader does not understand, naming the line
 * and what to write instead.
 */
export function ignoreRules(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trimEnd();
    if (line === '' || line.startsWith('#')) {
      return;
    }
    const refused = UNDERSTOOD_NOT.find(({ shape }) => shape.test(line));
    if (refused) {
      throw new Error(
        `.gitignore line ${String(index + 1)}, "${line}", is ${refused.what}; write it as a name, a path or a single star`,
      );
    }
    const directoryOnly = line.endsWith('/');
    const body = line.replace(/^\//, '').replace(/\/$/, '');
    rules.push({
      source: line,
      pattern: toPattern(body),
      anchored: line.startsWith('/') || body.includes('/'),
      directoryOnly,
    });
  });
  return rules;
}

function matches(rule: IgnoreRule, path: string, isDirectory: boolean): boolean {
  if (rule.directoryOnly && !isDirectory) {
    return false;
  }
  const name = path.slice(path.lastIndexOf('/') + 1);
  return rule.pattern.test(rule.anchored ? path : name);
}

/**
 * Whether `path`, written from the top of the repository with `/` between
 * segments, is ignored: the path itself or any directory on the way to it.
 */
export function isIgnored(
  rules: readonly IgnoreRule[],
  path: string,
  isDirectory: boolean,
): boolean {
  const segments = path.split('/');
  return segments.some((_, index) => {
    const prefix = segments.slice(0, index + 1).join('/');
    const prefixIsDirectory = index < segments.length - 1 || isDirectory;
    return rules.some((rule) => matches(rule, prefix, prefixIsDirectory));
  });
}

/**
 * Every file under `root` that `root/.gitignore` does not name, as sorted paths
 * from `root`, leaving out every directory named `.git`. Throws on a symbolic
 * link the rules do not name, on a second ignore file deeper in the
 * tree, whose rules this reader would otherwise skip, and on a rule shape
 * `ignoreRules` refuses.
 */
export function repositoryFiles(root: string): string[] {
  const top = join(root, '.gitignore');
  const rules = existsSync(top) ? ignoreRules(readFileSync(top, 'utf8')) : [];
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(join(root, directory)).sort()) {
      const path = directory === '' ? entry : `${directory}/${entry}`;
      if (entry === '.git') {
        continue;
      }
      const what = lstatSync(join(root, path));
      if (isIgnored(rules, path, what.isDirectory())) {
        continue;
      }
      if (what.isSymbolicLink()) {
        throw new Error(`${path} is a symbolic link; put the file itself in the repository`);
      }
      if (directory !== '' && entry === '.gitignore') {
        throw new Error(`${path} is a second ignore file; move its rules into the top .gitignore`);
      }
      if (what.isDirectory()) {
        walk(path);
      } else {
        found.push(path);
      }
    }
  };
  walk('');
  return found.sort();
}
