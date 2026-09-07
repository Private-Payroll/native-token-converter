// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GENERATED,
  ignoreDisagreements,
  LOCAL_ONLY,
  matchesPattern,
  PUBLISHED,
  publishRefusals,
  standingIn,
  standingOf,
  trackedRefusals,
} from '../src/publishable.js';

/** A tree holding exactly what is published, and one file kept on a machine. */
const aCleanTree = [...PUBLISHED, 'EXAMPLE.command'];

/** What .gitignore has to say for the two lists to agree. */
const anAgreeingGitignore = [...LOCAL_ONLY, ...GENERATED].join('\n');

describe('whether a pattern covers a path', () => {
  it('covers everything under a directory, and the directory itself', () => {
    expect(matchesPattern('node_modules/', 'node_modules')).toBe(true);
    expect(matchesPattern('node_modules/', 'node_modules/a/b.js')).toBe(true);
    expect(matchesPattern('node_modules/', 'src/index.ts')).toBe(false);
  });

  it('does not let a star cross a directory boundary', () => {
    expect(matchesPattern('src/*.ts', 'src/index.ts')).toBe(true);
    expect(matchesPattern('src/*.ts', 'src/deep/index.ts')).toBe(false);
  });

  it('matches a pattern with no slash against the file name at any depth', () => {
    expect(matchesPattern('*.command', 'EXAMPLE.command')).toBe(true);
    expect(matchesPattern('*.command', 'a/deep/EXAMPLE.command')).toBe(true);
    expect(matchesPattern('COMMIT-MESSAGE.md', 'COMMIT-MESSAGE.md')).toBe(true);
  });

  it('matches a pattern with a slash against the whole path and not the name', () => {
    expect(matchesPattern('contracts/managed/', 'managed/index.js')).toBe(false);
    expect(matchesPattern('src/index.ts', 'test/src/index.ts')).toBe(false);
  });

  it('treats a dot as a dot rather than as any character', () => {
    expect(matchesPattern('*.local.json', 'wordsxlocal.json')).toBe(false);
  });
});

describe('what the list says a file is', () => {
  it('answers published for a file it publishes', () => {
    expect(standingOf('src/index.ts')).toBe('published');
  });

  it('answers local for a file kept on the machine that wrote it', () => {
    expect(standingOf('EXAMPLE.command')).toBe('local');
    expect(standingOf('words.local.json')).toBe('local');
  });

  it('answers generated for what a tool writes', () => {
    expect(standingOf('node_modules/a/b.js')).toBe('generated');
    expect(standingOf('contracts/managed/contract/index.js')).toBe('generated');
  });

  it('answers unnamed for anything nobody has classified', () => {
    expect(standingOf('notes.md')).toBe('unnamed');
    expect(standingOf('src/scratch.ts')).toBe('unnamed');
  });

  it('answers local for a path on two lists, so the safe reading wins', () => {
    const onBoth = { published: ['thing.md'], local: ['thing.md'], generated: [] };
    expect(standingIn('thing.md', onBoth)).toBe('local');
  });

  it('answers local before generated, so a hand-written file is never a build product', () => {
    const onBoth = { published: [], local: ['thing.md'], generated: ['thing.md'] };
    expect(standingIn('thing.md', onBoth)).toBe('local');
  });
});

describe('what stops a publish', () => {
  it('says nothing about a tree that is exactly what is published', () => {
    expect(publishRefusals(aCleanTree)).toEqual([]);
  });

  it('refuses a file that is present and not named', () => {
    expect(publishRefusals([...aCleanTree, 'notes.md'])).toEqual([
      { path: 'notes.md', reason: 'present and not named' },
    ]);
  });

  it('refuses a file that is named and not present', () => {
    const withoutOne = aCleanTree.filter((path) => path !== 'SECURITY.md');
    expect(publishRefusals(withoutOne)).toEqual([
      { path: 'SECURITY.md', reason: 'named and not present' },
    ]);
  });

  it('does not require a file kept on the machine to be present', () => {
    expect(publishRefusals(PUBLISHED)).toEqual([]);
  });

  it('names the security page, which is the reason a reporter finds the route', () => {
    expect(PUBLISHED).toContain('SECURITY.md');
  });

  it('names each file once, in the order a person reads a directory in', () => {
    expect(new Set(PUBLISHED).size).toBe(PUBLISHED.length);
    expect([...PUBLISHED]).toEqual([...PUBLISHED].sort());
  });

  it('refuses a path that is a link, whatever the lists say about it', () => {
    expect(publishRefusals(aCleanTree, ['README.md'])).toEqual([
      { path: 'README.md', reason: 'present as a link rather than a file' },
    ]);
    expect(publishRefusals([...aCleanTree, 'somewhere'], ['somewhere'])).toEqual([
      { path: 'somewhere', reason: 'present as a link rather than a file' },
      { path: 'somewhere', reason: 'present and not named' },
    ]);
  });

  it('publishes nothing it also keeps back', () => {
    expect(publishRefusals(aCleanTree).filter((r) => r.reason === 'named twice')).toEqual([]);
  });
});

describe('what git is tracking, which the walk over the tree cannot see', () => {
  it('says nothing when the tracked files are exactly the published ones', () => {
    expect(trackedRefusals(PUBLISHED)).toEqual([]);
  });

  it('refuses a file that is tracked and not named, which the walk calls local', () => {
    expect(standingOf('words.local.json')).toBe('local');
    expect(trackedRefusals([...PUBLISHED, 'words.local.json'])).toEqual([
      { path: 'words.local.json', reason: 'tracked and not named' },
    ]);
    expect(trackedRefusals([...PUBLISHED, 'EXAMPLE.command'])).toEqual([
      { path: 'EXAMPLE.command', reason: 'tracked and not named' },
    ]);
  });

  it('refuses a file that is named and not tracked, so a commit cannot be short of one', () => {
    expect(trackedRefusals(PUBLISHED.filter((path) => path !== 'SECURITY.md'))).toEqual([
      { path: 'SECURITY.md', reason: 'named and not tracked' },
    ]);
  });
});

describe('whether the list and .gitignore still agree', () => {
  it('says nothing when they do', () => {
    expect(ignoreDisagreements(anAgreeingGitignore)).toEqual([]);
  });

  it('reads past comments and blank lines', () => {
    expect(ignoreDisagreements(`# why\n\n${anAgreeingGitignore}\n\n`)).toEqual([]);
  });

  it('refuses when something not published is not held back', () => {
    const missing = anAgreeingGitignore
      .split('\n')
      .filter((line) => line !== 'COMMIT-MESSAGE.md')
      .join('\n');
    expect(ignoreDisagreements(missing)).toEqual([
      'COMMIT-MESSAGE.md is not published, and .gitignore does not say so',
    ]);
  });

  it('agrees with the .gitignore this repository actually has', () => {
    const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
    expect(ignoreDisagreements(gitignore)).toEqual([]);
  });

  it('refuses when something is held back that the list does not account for', () => {
    expect(ignoreDisagreements(`${anAgreeingGitignore}\nsecrets/`)).toEqual([
      '.gitignore holds back secrets/, and this list does not account for it',
    ]);
  });
});
