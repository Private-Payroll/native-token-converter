// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { pathsCitedIn, unfollowableCitations } from '../scripts/self-contained.js';

const nothingExists = (): boolean => false;
const everythingExists = (): boolean => true;

describe('what counts as pointing somewhere', () => {
  // A path is found whole, however long its extension, so the check looks for the file that is
  // actually named.
  it('finds a path with a directory and an extension', () => {
    expect(pathsCitedIn('see contracts/converter/src/NativeTokenConverter.compact for it')).toEqual(
      ['contracts/converter/src/NativeTokenConverter.compact'],
    );
  });

  // A bare file name in prose is not a path. Reading it as one would refuse ordinary sentences.
  it('does not read a bare file name as a path', () => {
    expect(pathsCitedIn('the entry point is index.ts')).toEqual([]);
  });

  // Every dotted part of a file name is kept, so a test file or a minified file is looked for under
  // its full name.
  it('keeps every dotted part of a file name, not just the last', () => {
    expect(pathsCitedIn('a/b/thing.test.ts and c/d/e.min.js')).toEqual([
      'a/b/thing.test.ts',
      'c/d/e.min.js',
    ]);
  });

  // A path written from the file it is in, starting with ./ or ../, is a citation like any other
  // and is found.
  it('finds a path written relative to here', () => {
    expect(pathsCitedIn("import x from './src/toolchain.js';")).toEqual(['./src/toolchain.js']);
    expect(pathsCitedIn("import y from '../src/index.js';")).toEqual(['../src/index.js']);
  });

  // A path never starts in the middle of a longer name, so a file inside a scoped package is not
  // taken for one of this repository's.
  it('does not start a path inside a longer name', () => {
    expect(pathsCitedIn("import w from '@scope/pkg/index.js';")).toEqual([]);
  });

  // A package name has no extension, so an import from a package is not taken for a path in this
  // repository.
  it('is not fooled by a package name, which has no extension', () => {
    expect(pathsCitedIn("import y from '@midnight-ntwrk/compact-runtime';")).toEqual([]);
    expect(pathsCitedIn("import z from 'vitest/config';")).toEqual([]);
  });

  // A web address is followed by the reader's browser, not by this repository, so nothing inside
  // one is checked.
  it('ignores a web address, which a reader can follow without us', () => {
    expect(pathsCitedIn('https://example.test/some/where/thing.zip')).toEqual([]);
    expect(pathsCitedIn('https://example.test/page?from=src/nowhere.ts')).toEqual([]);
  });
});

describe('what a reader cannot follow', () => {
  // A path that is not here is reported with the line it is on, counted from one, so the reader can
  // go straight to it.
  it('reports a path that is not here, with the line it is on', () => {
    expect(unfollowableCitations('first\nsee docs/plan.md\n', nothingExists)).toEqual([
      { line: 2, text: 'docs/plan.md' },
    ]);
  });

  // A path that is here is not reported.
  it('says nothing about a path that is here', () => {
    expect(unfollowableCitations('see src/index.ts', everythingExists)).toEqual([]);
  });
});
