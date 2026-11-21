// SPDX-License-Identifier: Apache-2.0

/**
 * Where builds with keys go and what the manifest beside each records, checked
 * against folders made here rather than against a real build: every contract
 * source is found, a verifier key and a circuit file are recorded and a
 * proving key is not, and a build that is not there is refused with the
 * command that makes it.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildManifest,
  contractSources,
  isRecorded,
  keyedBuild,
  keyedBuildDirectory,
  manifestPath,
  manifestText,
} from '../src/keyed-builds.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');

function folder(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'keyed-builds-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/**
 * A path inside a folder made here, built from its parts. Written out whole it
 * would read as a citation of a file in this repository, which it is not.
 */
const at = (...segments: string[]): string => segments.join('/');

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

describe('the contracts compiled with keys', () => {
  it('are every contracts/<workspace>/src/<Name>.compact, in order, and nothing else', () => {
    const root = folder({
      [at('contracts', 'b', 'src', 'Second.compact')]: '',
      [at('contracts', 'a', 'src', 'First.compact')]: '',
      [at('contracts', 'a', 'src', 'notes.md')]: '',
      [at('contracts', 'a', 'test', 'Fixture.compact')]: '',
      [at('contracts', 'c', 'package.json')]: '{}',
    });
    expect(contractSources(root).map(({ workspace, name }) => [workspace, name])).toEqual([
      [join(root, 'contracts', 'a'), 'First'],
      [join(root, 'contracts', 'b'), 'Second'],
    ]);
  });

  it('include the converter and every test contract in this repository', () => {
    expect(contractSources(ROOT).map(({ name }) => name)).toEqual([
      'NativeTokenConverter',
      'CallingContract',
      'PublicTokenMinter',
      'WiderRecipientConverter',
    ]);
  });

  it('are each built into their own workspace, with the manifest beside the build', () => {
    expect(keyedBuildDirectory('/w', 'Name')).toBe(join('/w', 'managed-keys', 'Name'));
    expect(manifestPath('/w', 'Name')).toBe(join('/w', 'managed-keys', 'Name.manifest.json'));
  });
});

describe('a manifest', () => {
  it('records verifier keys and circuit files, and no proving key or generated code', () => {
    expect(isRecorded(at('keys', 'wrap.verifier'))).toBe(true);
    expect(isRecorded(at('zkir', 'wrap.zkir'))).toBe(true);
    expect(isRecorded(at('zkir', 'wrap.bzkir'))).toBe(true);
    expect(isRecorded(at('keys', 'wrap.prover'))).toBe(false);
    expect(isRecorded(at('contract', 'index.js'))).toBe(false);
  });

  it('holds the digest of each recorded file and what the build was made with', () => {
    const build = folder({
      [at('keys', 'wrap.verifier')]: 'verifier',
      [at('keys', 'wrap.prover')]: 'prover',
      [at('zkir', 'wrap.zkir')]: 'circuit',
      [at('contract', 'index.js')]: 'code',
    });
    const made = {
      contract: at('contracts', 'a', 'src', 'A.compact'),
      compiler: '0.36.1',
      platform: 'linux',
      arch: 'x64',
    };
    expect(buildManifest(build, made)).toEqual({
      ...made,
      sha256: {
        [at('keys', 'wrap.verifier')]: sha('verifier'),
        [at('zkir', 'wrap.zkir')]: sha('circuit'),
      },
    });
  });

  it('is written the same way every time, so two machines are compared by comparing the files', () => {
    const manifest = buildManifest(folder({ [at('zkir', 'a.zkir')]: 'a' }), {
      contract: 'c',
      compiler: 'v',
      platform: 'p',
      arch: 'a',
    });
    const text = manifestText(manifest);
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(manifest);
    expect(manifestText(JSON.parse(text) as typeof manifest)).toBe(text);
  });
});

describe('a build a test asks for', () => {
  it('is refused when it is not there, naming the command that makes it', () => {
    const workspace = join(
      folder({ [at('contracts', 'w', 'package.json')]: '{}' }),
      'contracts',
      'w',
    );
    expect(() => keyedBuild(workspace, 'Missing')).toThrow(
      /no build with keys at contracts\/w\/managed-keys\/Missing\. Run npm run compile:keys first/,
    );
  });

  it('is refused when it has code but no verifier key, as a build without keys does', () => {
    const workspace = folder({ [at('managed-keys', 'Half', 'contract', 'index.js')]: '' });
    expect(() => keyedBuild(workspace, 'Half')).toThrow(/no build with keys/);
  });

  it('is its folder when it holds the code and a verifier key', () => {
    const workspace = folder({
      [at('managed-keys', 'Whole', 'contract', 'index.js')]: '',
      [at('managed-keys', 'Whole', 'keys', 'wrap.verifier')]: '',
    });
    expect(keyedBuild(workspace, 'Whole')).toBe(join(workspace, 'managed-keys', 'Whole'));
  });
});
