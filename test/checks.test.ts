// SPDX-License-Identifier: Apache-2.0

/**
 * Every step of `npm run verify` runs on a pull request too. A contributor
 * runs the checks as one command and the workflow runs each as a job of its
 * own, so the two are written in two places; this reads both and refuses a step
 * of `verify` that no job and no part of the shared setup runs, so a check
 * added to one is not silently missing from the other.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

/** Every command a `run:` line in the file runs, with `npx` taken off, as npm runs a script's tools. */
function runLines(text: string): Set<string> {
  return new Set(
    [...text.matchAll(/^\s*(?:- )?run: (.+)$/gm)].map(([, command]) =>
      (command ?? '').trim().replace(/^npx /, ''),
    ),
  );
}

describe('the checks a pull request runs', () => {
  it('include every step of npm run verify', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> })
      .scripts;
    const steps = (scripts['verify'] ?? '').split('&&').map((step) => step.trim());
    const run = new Set([
      ...runLines(read('.github/workflows/ci.yml')),
      ...runLines(read('.github/actions/setup/action.yml')),
    ]);
    expect(steps.length).toBeGreaterThan(1);
    expect(steps.filter((step) => !run.has(step))).toEqual([]);
  });
});
