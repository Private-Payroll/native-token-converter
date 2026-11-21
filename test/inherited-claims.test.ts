// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NOTICES_EXPECTED,
  NOTICE_SOURCES,
  RUN_LENGTH,
  commentRuns,
  reproductions,
  retractedNotices,
  runsOf,
  significantWords,
} from '../scripts/inherited-claims.js';
import { repositoryFiles } from '../scripts/repository-files.js';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * The invented text below is deliberate nonsense.
 *
 * This file is in the repository, so the walk at the bottom reads it along
 * with everything else. A fixture written in the words of the real notice would be
 * refused by the check it is testing, and the tidy way out of that is an
 * exception for this file, which is the beginning of a check that no longer
 * covers the thing it was written for. Nonsense costs nothing and needs no
 * exception.
 */
const INVENTED = [
  '/**',
  ' * @description Ferries a quantity of gravel to the stated quarry.',
  ' *',
  ' * @notice The returned barrow is the sole barrow of the shifted gravel.',
  ' * Quarries cannot spot barrows tipped for them by squinting at the valley.',
  ' *',
  ' * @circuitInfo k=3, rows=7',
  ' *',
  ' * Requirements:',
  ' * - the quarry is not the empty quarry.',
  ' */',
  'export circuit ferry(): [] {}',
].join('\n');

const INVENTED_MARKERS = ['sole barrow', 'squinting at the valley'];

const invented = (text: string) =>
  commentRuns(text).flatMap((run) =>
    run.text
      .split(/(?=@[A-Za-z]+\b)/)
      .map((clause) => clause.replace(/\s+/g, ' ').trim())
      .filter((clause) => INVENTED_MARKERS.every((marker) => clause.toLowerCase().includes(marker)))
      .map((clause) => ({ source: 'invented', line: run.line, text: clause })),
  );

describe('reading words out of a text', () => {
  // Words are compared in lower case, with punctuation and backticks treated as gaps, so a notice
  // is recognised however it was capitalised or quoted.
  it('lowers case and treats everything but letters and digits as a gap', () => {
    expect(significantWords('A Barrow, `tipped`; twice-over.')).toEqual([
      'a',
      'barrow',
      'tipped',
      'twice',
      'over',
    ]);
  });

  it('gives back nothing for a line that is only punctuation', () => {
    expect(significantWords('  ***  ')).toEqual([]);
  });
});

describe('reading a comment as the paragraph it is', () => {
  // A comment written over several lines is read as one paragraph, because a sentence wrapped
  // across lines is still one sentence.
  it('joins consecutive comment lines into one run, and says where it starts', () => {
    expect(commentRuns('code\n// one\n// two\ncode\n')).toEqual([{ line: 2, text: 'one two' }]);
  });

  it('closes the run at the last line of a file', () => {
    expect(commentRuns('code\n// trailing')).toEqual([{ line: 2, text: 'trailing' }]);
  });

  it('keeps two comments apart when code separates them', () => {
    expect(commentRuns('// a\ncode\n// b')).toHaveLength(2);
  });
});

describe('finding the notice in a module', () => {
  // Only the notice itself is kept, cut at its tags, so the requirements listed further down the
  // same comment are not mistaken for part of it.
  it('keeps the notice and not the paragraphs around it', () => {
    const [notice] = invented(INVENTED);
    expect(notice?.text).toBe(
      '@notice The returned barrow is the sole barrow of the shifted gravel. Quarries cannot spot barrows tipped for them by squinting at the valley.',
    );
  });

  /**
   * A notice is retracted only when it carries every marker together. Each half
   * on its own is an ordinary sentence and must not be refused. This is tested
   * against the real markers, because the invented text carries neither of them
   * and would pass whichever way the markers were combined.
   */
  it('needs every marker, not one of them', () => {
    const half = '// @notice The barrow is the only copy of the gravel.';
    const otherHalf = '// @notice A quarry cannot spot a barrow by scanning the chain.';
    expect(retractedNotices('x', half)).toEqual([]);
    expect(retractedNotices('x', otherHalf)).toEqual([]);
  });

  // The markers are looked for anywhere inside the clause, not only at its start, which is where a
  // clause beginning with its tag would never have them.
  it('finds one that carries both', () => {
    const whole =
      '// @notice The barrow is the only copy, and a quarry cannot find it by scanning the chain.';
    expect(retractedNotices('x', whole)).toHaveLength(1);
  });
});

describe('what counts as reproducing one', () => {
  const notices = invented(INVENTED);

  // A copied claim that wraps over two lines is still found, because prose is rewrapped freely when
  // it is edited.
  it('finds a run that arrives wrapped over two lines', () => {
    const found = reproductions(
      'somewhere.md',
      'first line\nthe returned barrow is\nthe sole barrow of it\n',
      notices,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(2);
  });

  // Five shared words in a row are not enough to count as reproducing a notice, so ordinary phrases
  // in common do not refuse.
  it('says nothing about a run shorter than the length', () => {
    expect(reproductions('somewhere.md', 'the returned barrow is the', notices)).toEqual([]);
  });

  it('says nothing about prose that shares no run with it', () => {
    expect(
      reproductions('somewhere.md', 'gravel goes to the quarry by whatever route', notices),
    ).toEqual([]);
  });

  // Each run found says which notice it came from, so the reader can go and compare the two.
  it('reports which notice the run came from', () => {
    const found = reproductions('somewhere.md', 'the returned barrow is the sole barrow', notices);
    expect(found[0]?.source).toBe('invented');
  });

  it('cuts every run of the length out of the notice', () => {
    const words = significantWords(notices[0]?.text ?? '');
    expect(runsOf(notices).size).toBe(words.length - RUN_LENGTH + 1);
  });
});

/**
 * The corpus is not in this repository. It arrives with an install and is
 * replaced wholesale by one, so the way the check below stops working is by
 * having nothing to check, and an empty corpus passes everything.
 *
 * So these tests fail when the module is updated, reworded, renamed or not
 * installed at all. That is intended: each of those is a reason to open the
 * notices and read them again before trusting the check.
 */
describe('the notices this repository is answering', () => {
  const notices = NOTICE_SOURCES.flatMap((source) =>
    retractedNotices(source, readFileSync(source, 'utf8')),
  );

  it('finds every notice the pinned module carries', () => {
    expect(notices).toHaveLength(NOTICES_EXPECTED);
  });

  it('finds them in every module file, not only the first', () => {
    expect(new Set(notices.map((notice) => notice.source)).size).toBe(NOTICE_SOURCES.length);
  });

  /**
   * The one that matters, and the reason for all of the above: no file in this
   * repository repeats the token module's notice that a minted coin cannot be
   * found by its owner. That is not true of the coins this contract mints, and a
   * reader who believed it would think money is lost when it is not.
   */
  it('finds no file in the repository reproducing one', () => {
    const files = repositoryFiles(ROOT);
    expect(files).toContain('README.md');
    const found = files.flatMap((path) =>
      reproductions(path, readFileSync(join(ROOT, path), 'utf8'), notices),
    );
    expect(found).toEqual([]);
  });
});
