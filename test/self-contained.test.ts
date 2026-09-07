// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { helpersCitedIn, pathsCitedIn, unfollowableCitations } from '../src/self-contained.js';

const nothingExists = (): boolean => false;
const everythingExists = (): boolean => true;

describe('what counts as pointing somewhere', () => {
  it('finds a path with a directory and an extension', () => {
    expect(pathsCitedIn('see contracts/src/NativeTokenConverter.compact for it')).toEqual([
      'contracts/src/NativeTokenConverter.compact',
    ]);
  });

  it('keeps every dotted part of a file name, not just the last', () => {
    expect(pathsCitedIn('a/b/thing.test.ts and c/d/e.min.js')).toEqual([
      'a/b/thing.test.ts',
      'c/d/e.min.js',
    ]);
  });

  it('finds a path written relative to here', () => {
    expect(pathsCitedIn("import x from './src/toolchain.js';")).toEqual(['./src/toolchain.js']);
  });

  it('is not fooled by a package name, which has no extension', () => {
    expect(pathsCitedIn("import y from '@midnight-ntwrk/compact-runtime';")).toEqual([]);
    expect(pathsCitedIn("import z from 'vitest/config';")).toEqual([]);
  });

  it('ignores a web address, which a reader can follow without us', () => {
    expect(pathsCitedIn('https://example.test/some/where/thing.zip')).toEqual([]);
    expect(pathsCitedIn('https://example.test/page?from=src/nowhere.ts')).toEqual([]);
  });

  it('ignores what is inside a vendored directory, which is not ours to answer for', () => {
    expect(pathsCitedIn('../../node_modules/a-package/token/Thing.compact')).toEqual([]);
    expect(pathsCitedIn('a/nested/node_modules/thing/index.js')).toEqual([]);
    expect(pathsCitedIn('node_modules/a-package/index.js')).toEqual([]);
  });

  it('finds a local helper script by name alone', () => {
    expect(helpersCitedIn('double-click EXAMPLE.command to do the thing')).toEqual(['EXAMPLE.command']);
  });

  it('does not mistake ordinary prose for a helper script', () => {
    expect(helpersCitedIn('the command below')).toEqual([]);
  });
});

describe('what a reader cannot follow', () => {
  it('reports a path that is not here, with the line it is on', () => {
    expect(unfollowableCitations('first\nsee docs/plan.md\n', nothingExists)).toEqual([
      { line: 2, text: 'docs/plan.md', reason: 'missing' },
    ]);
  });

  it('says nothing about a path that is here', () => {
    expect(unfollowableCitations('see src/index.ts', everythingExists)).toEqual([]);
  });

  it('reports a local helper script even though the file is on the machine', () => {
    expect(unfollowableCitations('run EXAMPLE.command', everythingExists)).toEqual([
      { line: 1, text: 'EXAMPLE.command', reason: 'unpublished' },
    ]);
  });
});
