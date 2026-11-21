// SPDX-License-Identifier: Apache-2.0

/**
 * A reader of this repository should be able to follow every path it cites: a
 * file that names a path which is not here leaves the reader nowhere to go.
 *
 * The rule lives here, apart from the walk over the tree, so it can be tested
 * against text that is not on disk.
 */

/** One path a file points at that is not here, and the line it is on. */
export interface Citation {
  readonly line: number;
  readonly text: string;
}

const URL_PATTERN = /\bhttps?:\/\/\S+/g;

/**
 * A repository-relative path: at least one directory, and a final segment with
 * an extension. Package specifiers have no extension and so do not match. A
 * leading `./` or `../` is a directory segment like any other.
 */
const PATH_PATTERN =
  /(?<![\w@.$/-])([A-Za-z0-9_.-]+\/)+[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\.[A-Za-z0-9]+/g;

/** Text this repository does not own, and is not answerable for. */
function isVendored(path: string): boolean {
  return path === 'node_modules' || path.includes('node_modules/');
}

function withoutUrls(text: string): string {
  return text.replace(URL_PATTERN, (url) => ' '.repeat(url.length));
}

/**
 * Every path a single line points at, already stripped of URLs and of anything
 * under a vendored directory.
 */
export function pathsCitedIn(line: string): string[] {
  const found: string[] = [];
  for (const match of withoutUrls(line).matchAll(PATH_PATTERN)) {
    if (!isVendored(match[0])) {
      found.push(match[0]);
    }
  }
  return found;
}

/**
 * The citations in `text` that a reader could not follow.
 *
 * `exists` answers whether a cited path is present. Paths are reported exactly
 * as they are written, because where a citation points depends on the file it is
 * written in: the caller resolves it. A source file importing a sibling names it
 * with a `.js` extension even though the file on disk ends in `.ts`, so the
 * caller is expected to accept either.
 */
export function unfollowableCitations(text: string, exists: (path: string) => boolean): Citation[] {
  const unfollowable: Citation[] = [];
  text.split('\n').forEach((line, index) => {
    for (const cited of pathsCitedIn(line)) {
      if (!exists(cited)) {
        unfollowable.push({ line: index + 1, text: cited });
      }
    }
  });
  return unfollowable;
}
