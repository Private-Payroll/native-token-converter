// SPDX-License-Identifier: Apache-2.0

/**
 * Every package this repository installs is pinned to one exact version, in
 * every workspace, and a package named in more than one place is pinned to the
 * same version in each. A range lets two installs of the same commit run
 * different code, and two pins of one package let one workspace be checked
 * against a version another never runs. The manifests are found from the
 * root's own list of workspaces, so a workspace added later is read without
 * this file changing.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * The fields that install a package. A peer dependency and an engine say what
 * whoever installs the published library may bring, which is a range by
 * nature, so they are not pins and are not read.
 */
const INSTALLED = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

type Manifest = Readonly<Record<string, unknown>>;

interface Pin {
  readonly where: string;
  readonly name: string;
  readonly version: string;
}

const readJson = (path: string): Manifest =>
  JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Manifest;

/**
 * The folder of every workspace the root names. Only a pattern of one folder
 * followed by `/*` is read; any other shape is refused, because reading it
 * wrongly would check fewer workspaces than npm installs and say nothing.
 */
function workspaceFolders(patterns: unknown): string[] {
  if (!Array.isArray(patterns)) {
    throw new Error('the root package.json names no workspaces');
  }
  const folders: string[] = [];
  for (const pattern of patterns as unknown[]) {
    const parent = typeof pattern === 'string' ? /^([\w.-]+)\/\*$/.exec(pattern)?.[1] : undefined;
    if (parent === undefined) {
      throw new Error(
        `the workspace pattern ${JSON.stringify(pattern)} is not one folder followed by /*, which is all this reads`,
      );
    }
    if (!existsSync(join(ROOT, parent))) {
      continue;
    }
    for (const entry of readdirSync(join(ROOT, parent), { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(ROOT, parent, entry.name, 'package.json'))) {
        folders.push(`${parent}/${entry.name}`);
      }
    }
  }
  return folders.sort();
}

/** Every version an override sets, at any depth, by the package it names. */
function overridePins(where: string, overrides: unknown): Pin[] {
  if (typeof overrides !== 'object' || overrides === null) {
    return [];
  }
  return Object.entries(overrides as Manifest).flatMap(([name, value]) =>
    typeof value === 'string'
      ? [{ where, name, version: value }]
      : overridePins(`${where} ${name}`, value),
  );
}

/** Every pin in one manifest: what it installs, and what it overrides. */
function pinsOf(folder: string): Pin[] {
  const manifest = readJson(join(folder, 'package.json'));
  const where = folder === '.' ? 'package.json' : `${folder}/package.json`;
  const installed = INSTALLED.flatMap((field) =>
    Object.entries((manifest[field] ?? {}) as Readonly<Record<string, string>>).map(
      ([name, version]) => ({ where: `${where} ${field}`, name, version }),
    ),
  );
  return [...installed, ...overridePins(`${where} overrides`, manifest['overrides'])];
}

const root = readJson('package.json');
const everyPin = (): Pin[] =>
  ['.', ...workspaceFolders(root['workspaces'])].flatMap((folder) => pinsOf(folder));

describe('the versions this repository installs', () => {
  it('reads every workspace the lockfile installs, and no other', () => {
    const lock = readJson('package-lock.json')['packages'] as Manifest;
    const installed = Object.keys(lock)
      .filter(
        (key) => key !== '' && !key.startsWith('node_modules/') && !key.includes('/node_modules/'),
      )
      .sort();
    expect(workspaceFolders(root['workspaces'])).toEqual(installed);
  });

  it('reads every package the lockfile names for each workspace', () => {
    const lock = readJson('package-lock.json')['packages'] as Readonly<Record<string, Manifest>>;
    const unread = ['.', ...workspaceFolders(root['workspaces'])].flatMap((folder) => {
      const entry = lock[folder === '.' ? '' : folder] ?? {};
      const read = new Set(pinsOf(folder).map((pin) => pin.name));
      return Object.keys(entry)
        .filter((field) => /^(dev|optional)?[Dd]ependencies$/.test(field))
        .flatMap((field) => Object.keys(entry[field] as Manifest))
        .filter((name) => !read.has(name))
        .map((name) => `${folder} ${name}`);
    });
    expect(unread).toEqual([]);
  });

  it('takes a version as exact only when it names one release', () => {
    for (const exact of ['1.0.0', '0.21.0', '0.4.0-alpha.1', '10.20.30-rc.2']) {
      expect(EXACT.test(exact)).toBe(true);
    }
    for (const range of [
      '^1.0.0',
      '~1.0.0',
      '>=1.0.0',
      '1.0',
      '1.0.x',
      '*',
      'latest',
      '1.0.0 || 2.0.0',
      '1.0.0 - 2.0.0',
      'v1.0.0',
      'file:../a',
    ]) {
      expect(EXACT.test(range)).toBe(false);
    }
  });

  it('pins every package, in every workspace and in the overrides, to one exact version', () => {
    const ranges = everyPin().filter((pin) => !EXACT.test(pin.version));
    expect(ranges).toEqual([]);
  });

  it('pins a package named in more than one place to the same version in each', () => {
    const versions = new Map<string, Set<string>>();
    for (const pin of everyPin()) {
      versions.set(pin.name, (versions.get(pin.name) ?? new Set()).add(pin.version));
    }
    const split = [...versions].filter(([, found]) => found.size > 1).map(([name]) => name);
    expect(split).toEqual([]);
  });

  it('reads the version an override sets at any depth', () => {
    expect(overridePins('overrides', { a: '1.0.0', b: { c: '^2.0.0' } })).toEqual([
      { where: 'overrides', name: 'a', version: '1.0.0' },
      { where: 'overrides b', name: 'c', version: '^2.0.0' },
    ]);
  });

  it('refuses a workspace pattern it cannot read, rather than skip the workspaces it names', () => {
    expect(() => workspaceFolders(['packages/**'])).toThrow(/not one folder followed by/);
    expect(() => workspaceFolders(['tools/*', 3])).toThrow(/not one folder followed by/);
    expect(() => workspaceFolders(undefined)).toThrow(/names no workspaces/);
  });
});
