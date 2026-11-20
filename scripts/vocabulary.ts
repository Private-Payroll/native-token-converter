// SPDX-License-Identifier: Apache-2.0

/**
 * Text that must not reach a public history.
 *
 * A commit message, a pull request title and a branch name are permanent in a
 * way nothing else here is: they cannot be edited afterwards, and a reader
 * meets them before they meet the software. What belongs in them is what the
 * change does. What does not belong is anything about how the work that
 * produced it was arranged, who produced it, or which machine it was produced
 * on.
 *
 * Two kinds of rule, and they are kept apart on purpose.
 *
 * The rules in this file name nothing. A dash this project does not write and
 * an address belonging to a person are both recognised by shape, so they can
 * be published, and the workflow runs them on every pull request.
 *
 * The other kind is a list of words, and that list is deliberately not here.
 * A list of words a repository forbids is a document containing every one of
 * them, so publishing the guard would publish the thing the guard exists to
 * keep out. The list stays in a file the publish list does not name, and is
 * handed to `termOccurrences` when there is one to hand over. What runs
 * without it is this file; what needs it runs where the file is.
 */

/** One thing a text is refused for, and where in the text it is. */
export interface Occurrence {
  readonly line: number;
  readonly text: string;
  readonly name: string;
}

/** One entry in a list that is not published. */
export interface Term {
  readonly name: string;
  readonly pattern: string;
  readonly caseSensitive?: boolean;
}

/** A list that is not published, with the reason it is kept out of the tree. */
export interface Vocabulary {
  readonly why: string;
  readonly terms: readonly Term[];
}

/** How a text is read, where that depends on what the text is. */
export interface Reading {
  /**
   * Match every term without regard to case, whatever the term asks for.
   *
   * A subject line is lower case after the colon by rule, and a branch name is
   * lower case throughout by rule. A term written in capitals everywhere else
   * therefore arrives on those surfaces in lower case, and a term that asked to
   * be matched exactly would never see it there.
   *
   * It is asked for rather than assumed because it is not free. Read this way,
   * a term also refuses things that have nothing to do with the work, and a
   * file written by a tool is full of them while a sentence a person wrote is
   * not. On a permanent line of prose, being refused and told to say it
   * differently is the cheap mistake. On a file nobody wrote by hand it is
   * not a mistake anybody would put up with, and a guard people route around
   * costs more than what it was catching.
   */
  readonly ignoreCase?: boolean;
}

/**
 * A dash that is not the hyphen on a keyboard: the soft hyphen, the
 * typographic hyphen and its non-breaking twin, the figure dash, the en dash,
 * the em dash, the horizontal bar, the two and three em dashes, the minus
 * sign, the hyphen bullet and the full width form. This project writes the
 * plain one, so any of these arrived by being pasted in from a rendered page
 * or a typeset document, along with whatever else came with it. The soft
 * hyphen is first in the list because it is invisible and is what copying
 * hyphenated text out of a typeset page leaves behind.
 *
 * Written as code points rather than as the characters themselves, for the
 * same reason the list of words is not in this repository: a guard spelled out
 * in the thing it refuses has published it in the act of forbidding it, and
 * this one would refuse its own definition.
 */
const DASHES =
  /[\u00AD\u2010\u2011\u2012\u2013\u2014\u2015\u2043\u2212\u2E3A\u2E3B\uFE31\uFE32\uFE58\uFE63\uFF0D]/g;

/**
 * Characters that are there and cannot be seen: the zero width space, the two
 * zero width joiners, the word joiner and the byte order mark.
 *
 * A commit subject is reviewed by eye and by nothing else. One of these in it
 * is invisible in every view anybody has of it and is as permanent as the rest
 * of the line, so it is refused rather than left to be discovered by whoever
 * is one day puzzled that a search does not find a string they can see.
 */
const INVISIBLE = /[\u200B\u200C\u200D\u2060\uFEFF]/g;

const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Addresses that belong to nobody.
 *
 * The forwarding address git is configured with here is the identity this
 * history carries, so it is not a personal address. The rest are the domains
 * and top level domains reserved for documentation and testing, which exist
 * so that an example does not have to borrow a real person's address.
 */
const NOBODYS_ADDRESS = /(@|\.)(users\.noreply\.github\.com|example\.(com|net|org)|[^.@]+\.(test|example|invalid|localhost))$/;

/**
 * The same text with every run of whitespace flattened to one space, and, for
 * each character of the result, where in the original it came from.
 *
 * Reading a text line by line would miss anything said in more than one word,
 * because a commit body is wrapped at seventy-odd columns and a phrase of two
 * words falls across a break as often as not. The better the body is written,
 * the more breaks there are for it to fall across. So the reading happens on
 * the flattened text and the reporting happens on the original.
 *
 * A run of whitespace holding a BLANK LINE is left as a newline rather than
 * flattened, and that is the difference between the two things a break can
 * mean. A wrapped line is one sentence and its words belong next to each
 * other. A paragraph break is not: flattening it would join the last word of
 * one paragraph to the first word of the next and refuse a phrase the writer
 * never wrote.
 *
 * A collapsed run reports the position of its LAST character, so a match that
 * begins with a space is reported on the line the visible part of it is on
 * rather than on the line the break came from.
 */
interface Flattened {
  readonly text: string;
  readonly from: readonly number[];
}

/**
 * Whitespace, except the byte order mark, which JavaScript counts as
 * whitespace and this does not. Flattening it would swallow it into a space
 * and the rule that refuses characters nobody can see would never be given it.
 */
const WHITESPACE = /[^\S\uFEFF]/;

function flatten(text: string): Flattened {
  const pieces: string[] = [];
  const from: number[] = [];
  let at = 0;
  while (at < text.length) {
    if (!WHITESPACE.test(text.charAt(at))) {
      pieces.push(text.charAt(at));
      from.push(at);
      at += 1;
      continue;
    }
    let end = at;
    let newlines = 0;
    while (end < text.length && WHITESPACE.test(text.charAt(end))) {
      if (text.charAt(end) === '\n') {
        newlines += 1;
      }
      end += 1;
    }
    pieces.push(newlines >= 2 ? '\n' : ' ');
    from.push(end - 1);
    at = end;
  }
  return { text: pieces.join(''), from };
}

/**
 * Every match of `pattern` in the flattened text, with the line of the original
 * that each one starts on. Matches arrive in order, so the line is counted
 * forward rather than recounted from the top each time.
 */
function found(
  pattern: RegExp,
  flat: Flattened,
  original: string,
  name: string,
): Occurrence[] {
  const occurrences: Occurrence[] = [];
  let counted = 0;
  let line = 1;
  for (const match of flat.text.matchAll(pattern)) {
    const at = flat.from[match.index] ?? 0;
    while (counted < at) {
      if (original.charAt(counted) === '\n') {
        line += 1;
      }
      counted += 1;
    }
    occurrences.push({ line, text: match[0], name });
  }
  return occurrences;
}

/** Every dash in `text` that should have been a hyphen. */
export function dashOccurrences(text: string): Occurrence[] {
  return found(DASHES, flatten(text), text, 'a dash that is written here as a hyphen');
}

/** Every character in `text` that is present and cannot be seen. */
export function invisibleOccurrences(text: string): Occurrence[] {
  return found(
    INVISIBLE,
    flatten(text),
    text,
    'a character that is there and cannot be seen',
  );
}

/** Every address in `text` that belongs to a person. */
export function addressOccurrences(text: string): Occurrence[] {
  return found(ADDRESS, flatten(text), text, "a person's address").filter(
    (occurrence) => !NOBODYS_ADDRESS.test(occurrence.text),
  );
}

/**
 * What a pattern anchors itself to a line with, or null if it anchors nothing.
 *
 * A term is applied to text whose line breaks have been flattened, so `^` and
 * `$` no longer mean the start and end of a line, and a newline written into a
 * pattern can never match. A term written that way would compile, be accepted,
 * and match nothing for ever, which is the one failure a guard cannot report
 * on itself. So it is refused at the moment somebody writes it.
 *
 * A `^` at the start of a character class negates it and is left alone; that
 * is the one place either character means something else.
 */
export function anchoredAt(pattern: string): string | null {
  let escaped = false;
  let inClass = false;
  let atClassStart = false;
  for (const character of pattern) {
    if (escaped) {
      escaped = false;
      if (character === 'n' || character === 'r') {
        return `a line break written as \\${character}`;
      }
      atClassStart = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '\n' || character === '\r') {
      return 'a line break';
    }
    if (inClass) {
      if (character === ']' && !atClassStart) {
        inClass = false;
      }
      atClassStart = false;
      continue;
    }
    if (character === '[') {
      inClass = true;
      atClassStart = true;
      continue;
    }
    if (character === '^' || character === '$') {
      return `the line anchor ${character}`;
    }
  }
  return null;
}

/**
 * Reads a list that is not published, refusing anything it cannot use.
 *
 * An empty list is refused rather than accepted, and that is the point of this
 * function. A guard handed nothing to look for passes everything put to it and
 * says so in the same words it uses when there is nothing wrong, which is the
 * one failure a guard cannot report on itself.
 */
export function parseVocabulary(value: unknown): Vocabulary {
  if (typeof value !== 'object' || value === null) {
    throw new Error('a list of what must not ship is an object with `why` and `terms`');
  }
  const { why, terms } = value as { why?: unknown; terms?: unknown };
  if (typeof why !== 'string' || why.trim() === '') {
    throw new Error('`why` says why this list is not in the repository, and it has to say it');
  }
  if (!Array.isArray(terms) || terms.length === 0) {
    throw new Error('`terms` is a list with something in it: an empty one refuses nothing');
  }
  const read: Term[] = [];
  for (const [index, term] of terms.entries()) {
    if (typeof term !== 'object' || term === null) {
      throw new Error(`terms[${index}] is an object with \`name\` and \`pattern\``);
    }
    const { name, pattern, caseSensitive } = term as {
      name?: unknown;
      pattern?: unknown;
      caseSensitive?: unknown;
    };
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error(`terms[${index}] needs a \`name\` saying what it is, for the refusal to quote`);
    }
    if (typeof pattern !== 'string' || pattern === '') {
      throw new Error(`terms[${index}] needs a \`pattern\``);
    }
    try {
      new RegExp(pattern);
    } catch {
      throw new Error(`terms[${index}] (${name}) is not a pattern this can read: ${pattern}`);
    }
    const anchor = anchoredAt(pattern);
    if (anchor !== null) {
      throw new Error(
        `terms[${index}] (${name}) uses ${anchor}, and a term is matched against text whose line breaks have been flattened, so it would quietly match nothing. Say it without anchoring it to a line.`,
      );
    }
    if (caseSensitive !== undefined && typeof caseSensitive !== 'boolean') {
      throw new Error(`terms[${index}] (${name}) has a \`caseSensitive\` that is not true or false`);
    }
    read.push(
      caseSensitive === undefined ? { name, pattern } : { name, pattern, caseSensitive },
    );
  }
  return { why, terms: read };
}

/**
 * Every place `text` says one of the things `vocabulary` refuses.
 *
 * Matching ignores case unless a term asks not to, because the unsafe
 * direction is the one to take by default: a term added later is looked for in
 * both cases without anybody having to remember to say so.
 */
export function termOccurrences(
  text: string,
  vocabulary: Vocabulary,
  reading: Reading = {},
): Occurrence[] {
  const occurrences: Occurrence[] = [];
  const exactly = reading.ignoreCase === true ? false : undefined;
  const flat = flatten(text);
  for (const term of vocabulary.terms) {
    const pattern = new RegExp(term.pattern, (exactly ?? term.caseSensitive) === true ? 'g' : 'gi');
    occurrences.push(...found(pattern, flat, text, term.name));
  }
  return occurrences.sort((a, b) => a.line - b.line);
}

/**
 * Everything in `text` that must not be published, said in one sentence each.
 *
 * Without a vocabulary this is the half that names nothing, which is the half
 * that can run on a published checkout.
 */
export function whatMustNotBePublished(
  text: string,
  vocabulary?: Vocabulary,
  reading: Reading = {},
): Occurrence[] {
  return [
    ...dashOccurrences(text),
    ...invisibleOccurrences(text),
    ...addressOccurrences(text),
    ...(vocabulary === undefined ? [] : termOccurrences(text, vocabulary, reading)),
  ].sort((a, b) => a.line - b.line);
}

/**
 * How a refusal reads to the person who has to act on it.
 *
 * It says BEGINS rather than carries, because a phrase read across a wrapped
 * line starts on the line named and finishes on the next one, and telling
 * somebody a line carries a string that is not all on it sends them looking
 * for something they will not find.
 */
export function saidPlainly(occurrence: Occurrence): string {
  return `line ${occurrence.line} begins ${JSON.stringify(occurrence.text)}, which is ${occurrence.name}`;
}
