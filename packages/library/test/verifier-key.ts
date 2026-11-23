// SPDX-License-Identifier: Apache-2.0

/**
 * A well-formed verifier key for the tests, as the compiler writes one: the
 * runtime refuses bytes that are not a key, and the tests compile nothing. It
 * is the key of an unrelated circuit, so a state built with it is never the
 * converter's.
 */
export const A_VERIFIER_KEY = new Uint8Array(
  Buffer.from(
    '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' +
      'Xw0E00ZE44cXN9DVamb0BVSjExVK4zJiELFXPO',
    'base64',
  ),
);
