// SPDX-License-Identifier: Apache-2.0

/**
 * The colour a client derives. That it agrees with the colour the contract
 * actually mints is checked in test/converter.test.ts, against the running
 * circuit; this is about the shapes it accepts and refuses on the way there.
 */

import { encodeRawTokenType, sampleContractAddress, sampleRawTokenType } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import { isWrappedNoteOf, normaliseAddress, wrappedColour } from '../src/wrapped-colour.js';

const someColour = (): Uint8Array => encodeRawTokenType(sampleRawTokenType());
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('the colour a converter mints against a backing colour', () => {
  it('changes when the backing colour changes', () => {
    const address = sampleContractAddress();
    expect(hex(wrappedColour(someColour(), address))).not.toBe(
      hex(wrappedColour(someColour(), address)),
    );
  });

  it('changes when the converter changes', () => {
    const backing = someColour();
    expect(hex(wrappedColour(backing, sampleContractAddress()))).not.toBe(
      hex(wrappedColour(backing, sampleContractAddress()))
    );
  });

  it('is the same every time for the same pair, because there is only one pool', () => {
    const backing = someColour();
    const address = sampleContractAddress();
    expect(hex(wrappedColour(backing, address))).toBe(hex(wrappedColour(backing, address)));
  });

  it('refuses a backing colour that is not 32 bytes', () => {
    const address = sampleContractAddress();
    expect(() => wrappedColour(new Uint8Array(31), address)).toThrow(/32 bytes; got 31/);
    expect(() => wrappedColour(new Uint8Array(33), address)).toThrow(/32 bytes; got 33/);
  });
});

describe('a converter address', () => {
  const address = sampleContractAddress();

  it('is accepted with a 0x prefix', () => {
    expect(normaliseAddress(`0x${address}`)).toBe(address);
  });

  it('is accepted in upper case', () => {
    expect(normaliseAddress(address.toUpperCase())).toBe(address);
  });

  it('is refused when it is not 32 bytes of hex', () => {
    expect(() => normaliseAddress(address.slice(0, -1))).toThrow(/64 hex characters/);
    expect(() => normaliseAddress(`${address}00`)).toThrow(/64 hex characters/);
    expect(() => normaliseAddress(`${address.slice(0, -1)}z`)).toThrow(/64 hex characters/);
    expect(() => normaliseAddress('')).toThrow(/64 hex characters/);
  });
});

describe('deciding whether a note came from a pool', () => {
  const address = sampleContractAddress();
  const backing = someColour();

  it('rejects a note minted against a different backing colour', () => {
    expect(isWrappedNoteOf(wrappedColour(someColour(), address), backing, address)).toBe(false);
  });

  it('rejects a note minted by a different converter', () => {
    expect(isWrappedNoteOf(wrappedColour(backing, sampleContractAddress()), backing, address)).toBe(
      false,
    );
  });

  it('rejects the backing colour itself, which is not a note', () => {
    expect(isWrappedNoteOf(backing, backing, address)).toBe(false);
  });

  it('refuses a note colour that is not 32 bytes', () => {
    expect(() => isWrappedNoteOf(new Uint8Array(31), backing, address)).toThrow(
      /note colour is 32 bytes; got 31/,
    );
  });
});
