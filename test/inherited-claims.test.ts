// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs';
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
} from '../src/inherited-claims.js';
import { PUBLISHED } from '../src/publishable.js';

/**
 * The invented text below is deliberate nonsense.
 *
 * This file is published, so the walk at the bottom reads it along with
 * everything else. A fixture written in the words of the real notice would be
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
      .filter((clause) =>
        INVENTED_MARKERS.every((marker) => clause.toLowerCase().includes(marker)),
      )
      .map((clause) => ({ source: 'invented', line: run.line, text: clause })),
  );

describe('reading words out of a text', () => {
  // Red when significantWords stops lowering case, or stops treating
  // punctuation and backticks as gaps: watched, by removing .toLowerCase() and
  // then by narrowing the character class to whitespace.
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
  // Red when commentRuns reads line by line instead of joining a run: watched,
  // by making it push one entry per comment line.
  it('joins consecutive comment lines into one run, and says where it starts', () => {
    expect(commentRuns('code\n// one\n// two\ncode\n')).toEqual([
      { line: 2, text: 'one two' },
    ]);
  });

  it('closes the run at the last line of a file', () => {
    expect(commentRuns('code\n// trailing')).toEqual([{ line: 2, text: 'trailing' }]);
  });

  it('keeps two comments apart when code separates them', () => {
    expect(commentRuns('// a\ncode\n// b')).toHaveLength(2);
  });
});

describe('finding the notice in a module', () => {
  // Red when the clause is no longer cut at its tags, because the requirements
  // listed further down the same comment then come back with it: watched, by
  // matching against the whole comment run, which drags in the quarry line.
  it('keeps the notice and not the paragraphs around it', () => {
    const [notice] = invented(INVENTED);
    expect(notice?.text).toBe(
      '@notice The returned barrow is the sole barrow of the shifted gravel. Quarries cannot spot barrows tipped for them by squinting at the valley.',
    );
  });

  /**
   * Both halves, against the real markers rather than the invented ones.
   *
   * The first draft of this put the invented text to `retractedNotices`, which
   * carries neither real marker, so it returned nothing whether the markers
   * were required together or singly. It passed, and it could not have failed.
   * A mutation run is what said so.
   */
  it('needs every marker, not one of them', () => {
    const half = '// @notice The barrow is the only copy of the gravel.';
    const otherHalf = '// @notice A quarry cannot spot a barrow by scanning the chain.';
    expect(retractedNotices('x', half)).toEqual([]);
    expect(retractedNotices('x', otherHalf)).toEqual([]);
  });

  // Red when the markers are looked for anywhere but inside the clause:
  // watched, by matching with startsWith, at which a clause beginning with its
  // tag carries no marker and nothing is ever found.
  it('finds one that carries both', () => {
    const whole =
      '// @notice The barrow is the only copy, and a quarry cannot find it by scanning the chain.';
    expect(retractedNotices('x', whole)).toHaveLength(1);
  });
});

describe('what counts as reproducing one', () => {
  const notices = invented(INVENTED);

  // Red when reproductions stops reading across lines: watched, by reading the
  // file line by line, which misses a claim that arrives wrapped.
  it('finds a run that arrives wrapped over two lines', () => {
    const found = reproductions(
      'somewhere.md',
      'first line\nthe returned barrow is\nthe sole barrow of it\n',
      notices,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(2);
  });

  // Red when RUN_LENGTH is lowered: watched, by setting it to 4, at which the
  // five words below are enough and this passes when it should not.
  it('says nothing about a run shorter than the length', () => {
    expect(reproductions('somewhere.md', 'the returned barrow is the', notices)).toEqual([]);
  });

  it('says nothing about prose that shares no run with it', () => {
    expect(
      reproductions('somewhere.md', 'gravel goes to the quarry by whatever route', notices),
    ).toEqual([]);
  });

  // Red when runsOf stops carrying the source through: watched, by having it
  // record a constant, so a reader is told a run was found and not where from.
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
 * Red when the module is bumped, reworded, renamed or simply not installed, and
 * that is the intent rather than a cost: each of those is a reason to open
 * those notices and read them again. Watched, by deleting a notice from a copy
 * of the module outside this repository and by emptying the copy altogether.
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
   * The one that matters, and the reason for all of the above.
   *
   * Red when any published file reproduces a notice. Watched, by putting the
   * sentence back into copies of README.md and of the contract, outside this
   * repository, where it stood before it was replaced.
   */
  it('finds no published file reproducing one', () => {
    const found = PUBLISHED.flatMap((path) =>
      reproductions(path, readFileSync(path, 'utf8'), notices),
    );
    expect(found).toEqual([]);
  });
});
