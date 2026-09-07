// SPDX-License-Identifier: Apache-2.0

import { encodeRawTokenType, rawTokenType } from '@midnight-ntwrk/compact-runtime';

/** A colour is 32 bytes, on both sides of the converter. */
export const COLOUR_BYTES = 32;

/** A contract address is those 32 bytes written as lower-case hex. */
export const ADDRESS_HEX_LENGTH = COLOUR_BYTES * 2;

const HEX_32 = /^[0-9a-f]{64}$/;

/**
 * Normalises a contract address to the form the platform expects: 64 lower-case
 * hex characters, with an optional `0x` prefix removed.
 *
 * Throws on anything else. A converter address that is quietly accepted in the
 * wrong shape derives the wrong colour, and the wrong colour is how a holder
 * comes to believe a note is backed by something it is not.
 */
export function normaliseAddress(converterAddress: string): string {
  const bare = converterAddress.startsWith('0x')
    ? converterAddress.slice(2)
    : converterAddress;
  const lower = bare.toLowerCase();
  if (!HEX_32.test(lower)) {
    throw new Error(
      `a converter address is ${ADDRESS_HEX_LENGTH} hex characters; got ${JSON.stringify(converterAddress)}`,
    );
  }
  return lower;
}

function requireColour(bytes: Uint8Array, what: string): Uint8Array {
  if (bytes.length !== COLOUR_BYTES) {
    throw new Error(`a ${what} is ${COLOUR_BYTES} bytes; got ${bytes.length}`);
  }
  return bytes;
}

/**
 * The colour of the shielded note the converter at `converterAddress` mints
 * against the unshielded token `backingColour`.
 *
 * This is the whole of the one-pool-per-coin rule: the colour is a function of
 * the coin being wrapped and of the converter's address, so there is exactly one
 * pool per backing colour and nobody - including whoever deployed the converter
 * - chooses which. Deriving it costs nothing here, and would cost a whole
 * circuit on chain, which is why the contract does not offer it and every client
 * is expected to compute it.
 */
export function wrappedColour(
  backingColour: Uint8Array,
  converterAddress: string,
): Uint8Array {
  return encodeRawTokenType(
    rawTokenType(
      requireColour(backingColour, 'backing colour'),
      normaliseAddress(converterAddress),
    ),
  );
}

/**
 * Whether `noteColour` is the colour that the converter at `converterAddress`
 * mints against `backingColour`.
 *
 * This answers one question and not the one a holder usually wants. It says the
 * note came from that converter and that the converter holds that backing
 * colour against it. It says nothing about whether the backing colour is worth
 * anything, or is the asset the holder was told it was.
 */
export function isWrappedNoteOf(
  noteColour: Uint8Array,
  backingColour: Uint8Array,
  converterAddress: string,
): boolean {
  const expected = requireColour(
    wrappedColour(backingColour, converterAddress),
    'derived colour',
  );
  const actual = requireColour(noteColour, 'note colour');
  // Both sides are length-checked, including the one this function derived:
  // comparing every byte of an array shorter than expected is vacuously true,
  // and this answer failing open is how a holder comes to believe a note is
  // backed by something it is not.
  return expected.every((byte, index) => byte === actual[index]);
}
