// SPDX-License-Identifier: Apache-2.0

/**
 * What the published package carries, read from package.json and the build
 * configuration. The package is the client library and nothing else: the
 * repository's own checks, the tests and the contract source stay in the
 * repository, and nothing the library does not import is installed with it.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const manifest = JSON.parse(read('package.json')) as {
  readonly [field: string]: unknown;
  readonly files: readonly string[];
  readonly scripts: Readonly<Record<string, string>>;
  readonly exports: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
};
const build = JSON.parse(read('tsconfig.build.json')) as {
  readonly include: readonly string[];
  readonly compilerOptions: { readonly rootDir: string; readonly outDir: string };
};

/**
 * Every package a library source file imports, by name: a static import, an
 * import for its effect alone, a dynamic import and a require. A relative path
 * is the library's own file and is not a package.
 */
const importedByTheLibrary = (): Set<string> => {
  const names = new Set<string>();
  for (const file of readdirSync(new URL('../src', import.meta.url))) {
    const source = read(`src/${file}`);
    for (const [, specifier] of source.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'".][^'"]*)['"]/g)) {
      const parts = (specifier ?? '').split('/');
      names.add(parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1]}` : (parts[0] ?? ''));
    }
  }
  return names;
};

describe('the published package', () => {
  it('carries only what the build writes', () => {
    expect(manifest.files).toEqual([build.compilerOptions.outDir]);
  });

  it('is built from the library source alone', () => {
    expect(build.include).toEqual(['src']);
    expect(build.compilerOptions.rootDir).toBe('src');
  });

  it('points its entry and its types at what the build writes', () => {
    expect(Object.keys(manifest.exports)).toEqual(['.']);
    for (const field of ['main', 'module', 'browser', 'bin', 'types']) {
      expect(manifest[field]).toBeUndefined();
    }
    const entry = manifest.exports['.'];
    expect(entry?.['default']).toBe(`./${build.compilerOptions.outDir}/index.js`);
    expect(entry?.['types']).toBe(`./${build.compilerOptions.outDir}/index.d.ts`);
  });

  it('builds what it carries every time it is packed', () => {
    expect(manifest.scripts['prepack']).toBe('npm run build');
  });

  it('installs exactly the packages the library imports, each at one exact version', () => {
    expect(Object.keys(manifest.dependencies).sort()).toEqual([...importedByTheLibrary()].sort());
    for (const version of Object.values(manifest.dependencies)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    }
  });

  it('pins every tool it is built and checked with to one exact version', () => {
    for (const version of Object.values(manifest.devDependencies)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    }
  });
});
