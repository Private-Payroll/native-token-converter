// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('the compile script', () => {
  it('stops before building anything when the compiler it is given is not the pinned one', () => {
    const folder = mkdtempSync(join(tmpdir(), 'compiler-'));
    const fake = join(folder, 'compactc');
    writeFileSync(fake, '#!/bin/sh\necho "0.0.1 (0000000 2000-01-01)"\n');
    chmodSync(fake, 0o755);
    const run = (): string =>
      execFileSync(
        process.execPath,
        ['--import', 'tsx', join(import.meta.dirname, '..', 'scripts', 'compile.ts')],
        {
          cwd: join(import.meta.dirname, '..'),
          env: { ...process.env, COMPACTC: fake },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );
    expect(run).toThrow(/written against Compact compiler .* and found 0\.0\.1/);
  });
});
