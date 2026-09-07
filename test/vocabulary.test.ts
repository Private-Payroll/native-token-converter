// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  addressOccurrences,
  anchoredAt,
  dashOccurrences,
  invisibleOccurrences,
  parseVocabulary,
  saidPlainly,
  termOccurrences,
  whatMustNotBePublished,
} from '../src/vocabulary.js';

/**
 * The fixtures below are built rather than written out, and that is not a
 * flourish. This file is published, and the check that reads every published
 * file reads this one: a test whose subject is a refusal would otherwise be
 * refused by the thing it is testing.
 */
const EM = String.fromCodePoint(0x2014);
const EN = String.fromCodePoint(0x2013);
const personal = ['someone', 'somewhere.co.uk'].join('@');
const INVISIBLE = String.fromCodePoint(0x200b);

/**
 * A list of things to refuse that has nothing to do with this repository. The
 * real one is not published, so what is tested here is the machinery: whether
 * a list handed to these rules is applied the way it says.
 */
const invented = parseVocabulary({
  why: 'a list used by the tests and by nothing else',
  terms: [
    { name: 'a marsupial', pattern: '\\bquokkas?\\b' },
    { name: 'two words', pattern: '\\bmarmalade jar\\b' },
    { name: 'a preserve, spelled in lower case', pattern: '\\bmarmalade\\b', caseSensitive: true },
  ],
});

describe('a dash that should have been a hyphen', () => {
  it('finds an em dash and an en dash, with the line each is on', () => {
    expect(dashOccurrences(`first\nand ${EM} then\nand ${EN} then`)).toEqual([
      { line: 2, text: EM, name: 'a dash that is written here as a hyphen' },
      { line: 3, text: EN, name: 'a dash that is written here as a hyphen' },
    ]);
  });

  it('says nothing about a plain hyphen, which is what this project writes', () => {
    expect(dashOccurrences('a well-known thing - said plainly')).toEqual([]);
  });

  it('finds the ones that look like a hyphen and are not, the invisible one included', () => {
    for (const point of [0x00ad, 0x2010, 0x2011, 0x2012, 0x2015, 0x2043, 0x2212, 0xff0d]) {
      expect(dashOccurrences(`a ${String.fromCodePoint(point)} b`)).toHaveLength(1);
    }
  });
});

describe('a character that is there and cannot be seen', () => {
  it('finds one, which nothing reviewing by eye could', () => {
    for (const point of [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]) {
      expect(invisibleOccurrences(`wrap${String.fromCodePoint(point)}a token`)).toHaveLength(1);
    }
  });

  it('says nothing about a text that is only what it looks like', () => {
    expect(invisibleOccurrences('wrap a token and redeem it back')).toEqual([]);
  });
});

describe("an address belonging to a person", () => {
  it('finds one', () => {
    expect(addressOccurrences(`write to ${personal}`)).toEqual([
      { line: 1, text: personal, name: "a person's address" },
    ]);
  });

  it('says nothing about the forwarding address this history carries', () => {
    expect(addressOccurrences('1234+name@users.noreply.github.com')).toEqual([]);
  });

  it('says nothing about the domains reserved so examples need not borrow one', () => {
    expect(addressOccurrences('a@b.test')).toEqual([]);
    expect(addressOccurrences('someone@example.com')).toEqual([]);
    expect(addressOccurrences('someone@sub.example.org')).toEqual([]);
    expect(addressOccurrences('someone@thing.invalid')).toEqual([]);
  });
});

describe('a pattern anchored to a line', () => {
  it('finds the two anchors and a line break written into a pattern', () => {
    expect(anchoredAt('^quokka')).toMatch(/line anchor \^/);
    expect(anchoredAt('quokka$')).toMatch(/line anchor \$/);
    expect(anchoredAt('quokka\\njar')).toMatch(/line break written as/);
    expect(anchoredAt('quokka\\rjar')).toMatch(/line break written as/);
    expect(anchoredAt('quokka\njar')).toBe('a line break');
  });

  it('leaves alone the places those characters mean something else', () => {
    expect(anchoredAt('[^/]quokka')).toBeNull();
    expect(anchoredAt('\\^quokka\\$')).toBeNull();
    expect(anchoredAt('[\\]^]quokka')).toBeNull();
    expect(anchoredAt('\\bquokkas?\\b')).toBeNull();
  });

  it('finds an anchor after a character class has closed', () => {
    expect(anchoredAt('[abc]quokka$')).toMatch(/line anchor \$/);
  });
});

describe('reading a list that is not published', () => {
  it('refuses a list with nothing in it, which would refuse nothing', () => {
    expect(() => parseVocabulary({ why: 'because', terms: [] })).toThrow(
      /empty one refuses nothing/,
    );
  });

  it('refuses a list that does not say why it is kept out of the repository', () => {
    expect(() => parseVocabulary({ terms: [{ name: 'a', pattern: 'b' }] })).toThrow(/`why`/);
    expect(() => parseVocabulary({ why: '  ', terms: [{ name: 'a', pattern: 'b' }] })).toThrow(
      /`why`/,
    );
  });

  it('refuses a term with no name for a refusal to quote', () => {
    expect(() => parseVocabulary({ why: 'because', terms: [{ pattern: 'b' }] })).toThrow(
      /terms\[0\] needs a `name`/,
    );
  });

  it('refuses a pattern anchored to a line, which would match nothing for ever', () => {
    expect(() =>
      parseVocabulary({ why: 'because', terms: [{ name: 'anchored', pattern: '^quokka' }] }),
    ).toThrow(/would quietly match nothing/);
  });

  it('refuses a pattern it cannot read, rather than looking for nothing', () => {
    expect(() =>
      parseVocabulary({ why: 'because', terms: [{ name: 'broken', pattern: '(' }] }),
    ).toThrow(/is not a pattern this can read/);
  });

  it('refuses anything that is not a list at all', () => {
    expect(() => parseVocabulary(null)).toThrow(/`why` and `terms`/);
    expect(() => parseVocabulary({ why: 'because', terms: 'quokka' })).toThrow(/`terms` is a list/);
  });

  it('keeps what it was given', () => {
    expect(invented.terms).toEqual([
      { name: 'a marsupial', pattern: '\\bquokkas?\\b' },
      { name: 'two words', pattern: '\\bmarmalade jar\\b' },
      { name: 'a preserve, spelled in lower case', pattern: '\\bmarmalade\\b', caseSensitive: true },
    ]);
  });
});

describe('applying a list to a text', () => {
  it('ignores case unless the term asks not to', () => {
    expect(termOccurrences('A Quokka appeared', invented)).toEqual([
      { line: 1, text: 'Quokka', name: 'a marsupial' },
    ]);
    expect(termOccurrences('Marmalade on toast', invented)).toEqual([]);
    expect(termOccurrences('marmalade on toast', invented)).toEqual([
      { line: 1, text: 'marmalade', name: 'a preserve, spelled in lower case' },
    ]);
  });

  it('will not read a phrase across a blank line, which is a paragraph and not a wrap', () => {
    expect(termOccurrences('a marmalade\n\njar was here', invented)).not.toContainEqual(
      expect.objectContaining({ name: 'two words' }),
    );
    expect(termOccurrences('a marmalade\n \n jar was here', invented)).not.toContainEqual(
      expect.objectContaining({ name: 'two words' }),
    );
  });

  it('reports the line the visible part of a match is on', () => {
    const spaced = parseVocabulary({
      why: 'a list used by the tests and by nothing else',
      terms: [{ name: 'a spaced term', pattern: ' zebra' }],
    });
    expect(termOccurrences('one\ntwo\n zebra', spaced).map((o) => o.line)).toEqual([3]);
  });

  it('finds a phrase broken across a line, which is what wrapping a body does', () => {
    expect(termOccurrences('a marmalade\njar was here', invented)).toContainEqual({
      line: 1,
      text: 'marmalade jar',
      name: 'two words',
    });
    expect(termOccurrences('a marmalade\nspoon was here', invented)).not.toContainEqual(
      expect.objectContaining({ name: 'two words' }),
    );
  });

  it('counts the line from the original rather than from the flattened text', () => {
    expect(termOccurrences('one\ntwo\nthree quokka', invented).map((o) => o.line)).toEqual([3]);
    expect(termOccurrences('one\n\n\nquokka', invented).map((o) => o.line)).toEqual([4]);
  });

  it('reports every occurrence rather than the first', () => {
    expect(termOccurrences('quokka\nquokka', invented)).toHaveLength(2);
  });

  it('reports them in the order somebody would read them', () => {
    expect(termOccurrences('marmalade\nquokka', invented).map((o) => o.line)).toEqual([1, 2]);
  });
});

describe('everything that must not be published', () => {
  it('runs the rules that name nothing when there is no list to hand', () => {
    expect(whatMustNotBePublished(`a ${EM} b`).map((o) => o.name)).toEqual([
      'a dash that is written here as a hyphen',
    ]);
    expect(whatMustNotBePublished(`a${INVISIBLE} b`).map((o) => o.name)).toEqual([
      'a character that is there and cannot be seen',
    ]);
    expect(whatMustNotBePublished(`a ${personal}`).map((o) => o.name)).toEqual([
      "a person's address",
    ]);
    expect(whatMustNotBePublished('a quokka')).toEqual([]);
  });

  it('adds the list when there is one', () => {
    expect(whatMustNotBePublished('a quokka', invented).map((o) => o.name)).toEqual(['a marsupial']);
  });

  it('says nothing about a text that is only about the software', () => {
    expect(whatMustNotBePublished('wrap a token and redeem it back', invented)).toEqual([]);
  });

  it('reports what it finds in the order somebody reads it, whichever rule found it', () => {
    const text = `a quokka\nand ${EM} then\nand ${personal}`;
    expect(whatMustNotBePublished(text, invented).map((o) => [o.line, o.name])).toEqual([
      [1, 'a marsupial'],
      [2, 'a dash that is written here as a hyphen'],
      [3, "a person's address"],
    ]);
  });
});

describe('how a refusal reads', () => {
  it('quotes what it found and names what it is', () => {
    expect(saidPlainly({ line: 4, text: 'quokka', name: 'a marsupial' })).toBe(
      'line 4 begins "quokka", which is a marsupial',
    );
  });
});
