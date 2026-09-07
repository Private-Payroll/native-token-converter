// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { COMPACTC_VERSION, releaseAsset, releaseUrl, wrongVersion } from '../src/toolchain.js';

describe('the pinned toolchain', () => {
  it('names a published release rather than a candidate', () => {
    expect(COMPACTC_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('picks the asset for the machine it is asked about', () => {
    expect(releaseAsset('darwin', 'arm64')).toBe(`compactc_v${COMPACTC_VERSION}_aarch64-darwin.zip`);
    expect(releaseAsset('darwin', 'x64')).toBe(`compactc_v${COMPACTC_VERSION}_x86_64-darwin.zip`);
    expect(releaseAsset('linux', 'arm64')).toBe(
      `compactc_v${COMPACTC_VERSION}_aarch64-unknown-linux-musl.zip`,
    );
    expect(releaseAsset('linux', 'x64')).toBe(
      `compactc_v${COMPACTC_VERSION}_x86_64-unknown-linux-musl.zip`,
    );
  });

  it('refuses a machine it has no compiler for, rather than guessing one', () => {
    expect(() => releaseAsset('win32', 'x64')).toThrow(/no pinned Compact compiler for win32/);
  });

  it('fetches that asset from the release it is pinned to', () => {
    expect(releaseUrl('a.zip')).toBe(
      `https://github.com/midnightntwrk/compact/releases/download/compactc-v${COMPACTC_VERSION}/a.zip`,
    );
  });

  it('says what a wrong compiler costs, not just that it is wrong', () => {
    expect(wrongVersion('0.31.1')).toContain('0.31.1');
    expect(wrongVersion('0.31.1')).toContain(COMPACTC_VERSION);
    expect(wrongVersion('0.31.1')).toMatch(/nothing says so until it is deployed/);
  });

  it('says what to do about a wrong compiler, not only that it is wrong', () => {
    expect(wrongVersion('0.31.1')).toMatch(/Delete the fetched compiler and build again/);
  });
});
