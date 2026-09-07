// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  authorProblem,
  branchFor,
  BRANCH_LIMIT,
  branchProblem,
  KINDS,
  messageProblem,
  subjectProblem,
  SUBJECT_LIMIT,
} from '../src/commit.js';
import { parseVocabulary } from '../src/vocabulary.js';

/**
 * Built rather than written out: this file is published, and the check that
 * reads every published file reads this one. A test whose subject is a refusal
 * would otherwise be refused by the thing it is testing.
 */
const EM = String.fromCodePoint(0x2014);
const personal = ['someone', 'somewhere.co.uk'].join('@');

/** A list that has nothing to do with this repository. The real one is not published. */
const invented = parseVocabulary({
  why: 'a list used by the tests and by nothing else',
  terms: [
    { name: 'a marsupial', pattern: '\\bquokkas?\\b' },
    { name: 'a call sign, written in capitals', pattern: '\\bQX[0-9]\\b', caseSensitive: true },
  ],
});

describe('a subject line', () => {
  it('passes when it names a kind and says what changed', () => {
    expect(subjectProblem('feat: wrap and redeem a native token')).toBeNull();
    expect(subjectProblem('fix(redeem): pay out the colour that was burned')).toBeNull();
  });

  it('has to say something', () => {
    expect(subjectProblem('')).toMatch(/say what the change does/);
    expect(subjectProblem('   ')).toMatch(/say what the change does/);
  });

  it('has to name one of the kinds', () => {
    expect(subjectProblem('wrap and redeem a native token')).toMatch(/reads "kind: what changed"/);
    expect(subjectProblem('sundry: wrap a token')).toMatch(/reads "kind: what changed"/);
    for (const kind of KINDS) {
      expect(subjectProblem(`${kind}: say what changed`)).toBeNull();
    }
  });

  it('is at most 72 characters, counted as characters and not as bytes', () => {
    const long = `feat: ${'a'.repeat(SUBJECT_LIMIT - 5)}`;
    expect([...long].length).toBe(SUBJECT_LIMIT + 1);
    expect(subjectProblem(long)).toMatch(/at most 72 characters, and this one is 73/);
    expect(subjectProblem(long.slice(0, -1))).toBeNull();
    const accented = `feat: ${'é'.repeat(SUBJECT_LIMIT - 6)}`;
    expect(Buffer.byteLength(accented)).toBeGreaterThan(SUBJECT_LIMIT);
    expect(subjectProblem(accented)).toBeNull();
  });

  it('does not end with a full stop', () => {
    expect(subjectProblem('feat: wrap a token.')).toMatch(/full stop/);
  });

  it('is not capitalised after the colon', () => {
    expect(subjectProblem('feat: Wrap a token')).toMatch(/not capitalised/);
  });
});

describe('the branch a change belongs on', () => {
  it('is the kind and what changed, and nothing about who did it', () => {
    expect(branchFor('feat: wrap and redeem a native token')).toBe(
      'feat/wrap-and-redeem-a-native-token',
    );
  });

  it('drops the scope, which belongs in the subject rather than the branch', () => {
    expect(branchFor('fix(redeem): pay out what was burned')).toBe('fix/pay-out-what-was-burned');
  });

  it('keeps only letters, digits and single hyphens', () => {
    expect(branchFor('docs: say what "backing" means (really)')).toBe(
      'docs/say-what-backing-means-really',
    );
  });

  it('stops at whole words rather than cutting one in half', () => {
    expect(branchFor('feat: derive the pool from the backing colour rather than'))
      .toBe('feat/derive-the-pool-from-the-backing-colour');
  });

  it('refuses to name a branch after a subject that does not read well', () => {
    expect(() => branchFor('Wrapped things')).toThrow(/reads "kind: what changed"/);
  });
});

describe('a whole commit message', () => {
  it('passes when it is a subject alone', () => {
    expect(messageProblem('feat: wrap and redeem a native token\n')).toBeNull();
  });

  it('passes when a blank line separates the subject from the body', () => {
    expect(messageProblem('feat: wrap a token\n\nThe pool is derived.\n')).toBeNull();
  });

  it('refuses a body run onto the subject', () => {
    expect(messageProblem('feat: wrap a token\nThe pool is derived.')).toMatch(
      /blank line separates/,
    );
  });

  it('refuses a line that says who produced the change', () => {
    expect(messageProblem('feat: wrap a token\n\nCo-authored-by: someone <a@b.test>')).toMatch(
      /says what changed, not who changed it/,
    );
    expect(messageProblem('feat: wrap a token\n\nGenerated with a tool')).toMatch(
      /says what changed, not who changed it/,
    );
    expect(messageProblem('feat: wrap a token\n\nSigned-off-by: someone')).toMatch(
      /says what changed, not who changed it/,
    );
  });

  it('carries the subject rules with it', () => {
    expect(messageProblem('Wrapped things')).toMatch(/reads "kind: what changed"/);
  });
});

describe('a branch name', () => {
  it('passes when it is a kind and what changed', () => {
    expect(branchProblem('feat/wrap-a-native-token')).toBeNull();
  });

  it('is what branchFor produces, so a derived name never has to be corrected', () => {
    for (const kind of KINDS) {
      expect(branchProblem(branchFor(`${kind}: pay out what was burned`))).toBeNull();
    }
    expect(branchProblem(branchFor('docs: say what "backing" means (really)'))).toBeNull();
  });

  it('has to say something', () => {
    expect(branchProblem('')).toMatch(/say what the change does/);
    expect(branchProblem('   ')).toMatch(/say what the change does/);
  });

  it('has to name one of the kinds, in lower case, with single hyphens', () => {
    expect(branchProblem('wrap-a-token')).toMatch(/reads "kind\/what-changed"/);
    expect(branchProblem('sundry/wrap-a-token')).toMatch(/reads "kind\/what-changed"/);
    expect(branchProblem('feat/Wrap-A-Token')).toMatch(/reads "kind\/what-changed"/);
    expect(branchProblem('feat/wrap--a--token')).toMatch(/reads "kind\/what-changed"/);
    expect(branchProblem('feat/wrap-a-token-')).toMatch(/reads "kind\/what-changed"/);
  });

  it('is at most 60 characters, because it is a path before it is a name', () => {
    const long = `feat/${'a'.repeat(BRANCH_LIMIT - 4)}`;
    expect(long.length).toBe(BRANCH_LIMIT + 1);
    expect(branchProblem(long)).toMatch(/at most 60 characters, and this one is 61/);
    expect(branchProblem(long.slice(0, -1))).toBeNull();
  });

  it('refuses a name that says something about the work rather than the change', () => {
    expect(branchProblem('feat/a-quokka-appeared', invented)).toMatch(/a marsupial/);
    expect(branchProblem('feat/a-quokka-appeared')).toBeNull();
  });

  it('is read without regard to case, because a branch name is lower case by rule', () => {
    expect(branchProblem('feat/qx7-wrap-a-token', invented)).toMatch(/a call sign/);
  });
});

describe('the name a commit is authored under', () => {
  it('passes when it says nothing but who is publishing', () => {
    expect(authorProblem('Native Token Converter')).toBeNull();
  });

  it('has to be set at all', () => {
    expect(authorProblem('')).toMatch(/authored under a name, and none is set/);
    expect(authorProblem('   ')).toMatch(/authored under a name, and none is set/);
  });

  it('is held to the same rules as the message, because it is just as permanent', () => {
    expect(authorProblem(`a name ${EM} really`)).toMatch(/dash that is written here as a hyphen/);
    expect(authorProblem(personal)).toMatch(/a person's address/);
    expect(authorProblem('the quokka keeper', invented)).toMatch(/a marsupial/);
    expect(authorProblem('qx7', invented)).toMatch(/a call sign/);
  });
});

describe('what a message may never carry', () => {
  it('refuses a dash that should have been a hyphen', () => {
    expect(messageProblem(`feat: wrap a token\n\nThe pool ${EM} derived.`)).toMatch(
      /dash that is written here as a hyphen/,
    );
    expect(messageProblem(`feat: wrap a token ${EM} really`)).toMatch(
      /dash that is written here as a hyphen/,
    );
  });

  it('refuses a character that is there and cannot be seen', () => {
    const invisible = String.fromCodePoint(0x200b);
    expect(messageProblem(`feat: wrap a${invisible} token`)).toMatch(/cannot be seen/);
    expect(messageProblem(`feat: wrap a token\n\nThe pool${invisible} is derived.`)).toMatch(
      /cannot be seen/,
    );
    expect(branchProblem(`feat/wrap-a${invisible}-token`)).toMatch(/kind\/what-changed/);
  });

  it("refuses an address belonging to a person", () => {
    expect(messageProblem(`feat: wrap a token\n\nAsk ${personal} about it.`)).toMatch(
      /a person's address/,
    );
  });

  it('accepts the forwarding address this history carries, and a reserved example', () => {
    expect(
      messageProblem('feat: wrap a token\n\nSee 1234+name@users.noreply.github.com.'),
    ).toBeNull();
    expect(messageProblem('feat: wrap a token\n\nSee someone@example.com.')).toBeNull();
  });

  it('refuses a trailer saying who produced the change, whatever it is called', () => {
    expect(messageProblem('feat: wrap a token\n\nReviewed-by: someone')).toMatch(
      /not who changed it/,
    );
    expect(messageProblem('feat: wrap a token\n\nAssisted-by: something')).toMatch(
      /not who changed it/,
    );
    expect(messageProblem('feat: wrap a token\n\nAuthored with a thing')).toMatch(
      /not who changed it/,
    );
  });

  it('does not mistake ordinary prose for a trailer', () => {
    expect(messageProblem('feat: wrap a token\n\nSide-by-side with the old one.')).toBeNull();
    expect(messageProblem('feat: wrap a token\n\nStand-by is not a state here.')).toBeNull();
  });

  it('refuses the mark a tool leaves on what it wrote', () => {
    expect(messageProblem('feat: wrap a token\n\n\u{1F916} written by something')).toMatch(
      /not what wrote it/,
    );
  });

  it('is read without regard to case, because a subject line is lower case by rule', () => {
    expect(messageProblem('feat: qx7 wraps a token', invented)).toMatch(/a call sign/);
    expect(messageProblem('feat: wrap a token\n\nDone under qx7.', invented)).toMatch(
      /a call sign/,
    );
  });

  it('reads a body as it is written, so a phrase broken by a line wrap is still found', () => {
    expect(
      messageProblem('feat: wrap a token\n\nThe pool is derived, as a\nquokka would.', invented),
    ).toMatch(/a marsupial/);
    expect(
      messageProblem(
        `feat: wrap a token\n\nAsk\n${['someone', 'somewhere.co.uk'].join('@')}\nabout it.`,
      ),
    ).toMatch(/a person's address/);
  });

  it('refuses anything on a list it is handed, in the subject or in the body', () => {
    expect(messageProblem('feat: a quokka appeared', invented)).toMatch(/a marsupial/);
    expect(messageProblem('feat: wrap a token\n\nA quokka appeared.', invented)).toMatch(
      /a marsupial/,
    );
    expect(subjectProblem('feat: a quokka appeared', invented)).toMatch(/a marsupial/);
  });

  it('says nothing about those same words when it is handed no list', () => {
    expect(messageProblem('feat: a quokka appeared')).toBeNull();
    expect(subjectProblem('feat: a quokka appeared')).toBeNull();
  });
});
