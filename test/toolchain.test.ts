// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMPACTC_SHA256,
  COMPACTC_VERSION,
  digestProblem,
  releaseAsset,
  releaseUrl,
  reportedVersion,
  wrongVersion,
} from '../scripts/toolchain.js';

describe('the pinned toolchain', () => {
  it('is the compiler version the README shows a reader', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme).toContain(`badge/Compact-${COMPACTC_VERSION}-`);
  });

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

  it('reads the version a compiler reports and ignores the build it names after it', () => {
    expect(reportedVersion('0.36.1 (7fa3a117c 2026-11-11)\n')).toBe('0.36.1');
    expect(reportedVersion('0.34.0\n')).toBe('0.34.0');
    expect(reportedVersion('\n  0.36.1 (7fa3a117c 2026-11-11)')).toBe('0.36.1');
  });

  it('does not read a version from what a compiler prints before it', () => {
    expect(reportedVersion('compactc 0.36.1')).toBe('compactc');
  });

  it('says what a wrong compiler costs, not just that it is wrong', () => {
    expect(wrongVersion('0.31.1')).toContain('0.31.1');
    expect(wrongVersion('0.31.1')).toContain(COMPACTC_VERSION);
    expect(wrongVersion('0.31.1')).toMatch(/nothing says so until it is deployed/);
  });

  it('says what to do about a wrong compiler, not only that it is wrong', () => {
    expect(wrongVersion('0.31.1')).toMatch(/Delete the fetched compiler and build again/);
  });

  it('has the published digest of the pinned compiler for every machine it fetches for', () => {
    for (const [os, cpu] of [
      ['darwin', 'arm64'],
      ['darwin', 'x64'],
      ['linux', 'arm64'],
      ['linux', 'x64'],
    ] as const) {
      expect(COMPACTC_SHA256[releaseAsset(os, cpu)]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('holds a different digest for every machine, so no entry was copied from another', () => {
    const digests = Object.values(COMPACTC_SHA256);
    expect(new Set(digests).size).toBe(digests.length);
  });

  it('holds no digest for any compiler but the pinned one', () => {
    for (const asset of Object.keys(COMPACTC_SHA256)) {
      expect(asset).toContain(`_v${COMPACTC_VERSION}_`);
    }
  });

  it('lets an archive be unpacked only when it matches its published digest', () => {
    const asset = releaseAsset('linux', 'x64');
    const published = COMPACTC_SHA256[asset] ?? '';
    expect(digestProblem(asset, published)).toBeUndefined();
    expect(digestProblem(asset, '0'.repeat(64))).toMatch(/does not match the digest its release published/);
  });

  it('refuses a digest that differs only in its last character, or only in its case', () => {
    const asset = releaseAsset('linux', 'x64');
    const published = COMPACTC_SHA256[asset] ?? '';
    const lastFlipped = `${published.slice(0, -1)}${published.endsWith('0') ? '1' : '0'}`;
    expect(digestProblem(asset, lastFlipped)).toMatch(/does not match/);
    expect(digestProblem(asset, published.toUpperCase())).toMatch(/does not match/);
  });

  it('refuses an archive it holds no digest for, rather than trusting it', () => {
    expect(digestProblem('compactc_v9.9.9_x86_64-darwin.zip', '0'.repeat(64))).toMatch(
      /no published digest/,
    );
  });
});

describe('the compile script', () => {
  it('stops before building anything when the compiler it is given is not the pinned one', () => {
    const folder = mkdtempSync(join(tmpdir(), 'compiler-'));
    const fake = join(folder, 'compactc');
    writeFileSync(fake, '#!/bin/sh\necho "0.0.1 (0000000 2000-01-01)"\n');
    chmodSync(fake, 0o755);
    const run = (): string =>
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/compile.ts'], {
        cwd: join(import.meta.dirname, '..'),
        env: { ...process.env, COMPACTC: fake },
        encoding: 'utf8',
        stdio: 'pipe',
      });
    expect(run).toThrow(/written against Compact compiler .* and found 0\.0\.1/);
  });
});
