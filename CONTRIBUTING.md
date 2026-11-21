# Contributing

## What gets checked

The Node version is the one in `.nvmrc`. After `npm ci`, `npm run verify` checks
the formatting, compiles the contract, builds the client library, checks that
every path this repository cites is in it, typechecks, lints, and runs the
tests. `npm run format` fixes the formatting.

A pull request runs each of those as a check of its own, so the page shows which
one failed, and three more: `keys` compiles every contract with its proving and
verifier keys and checks the local chain tests against those builds, `local-chain`
deploys and calls the contracts on a chain started on the runner, and `analyse`
is static analysis. A pull request that changes a dependency is also reviewed for
what that dependency brings with it.

`npm run test:local-chain` runs the local chain tests on your own machine, with
Docker running. They start their own node, indexer and proof server unless
`LOCAL_CHAIN_NODE`, `LOCAL_CHAIN_INDEXER` and `LOCAL_CHAIN_PROOF_SERVER` name
running ones, each as an http or https address with no path; the node and the
indexer are named together or not at all. `LOCAL_CHAIN_LOG_LEVEL` sets how much
the test wallet logs, `warn` unless it is set.

## Naming a change

This repository squashes a pull request with its title and description as the
commit message, so the title becomes the commit subject and is held to what a
subject line has to be when it is merged:

```
kind: what changed
```

- **kind** is one of `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`,
  `refactor`, `test`. An optional scope goes in brackets: `fix(redeem): ...`.
- What changed starts with a verb in the imperative and does not end with a
  full stop.
- The whole subject is at most 72 characters, counting the ` (#N)` the merge
  adds after it.

The branch name follows from the title: `feat: wrap a native token` belongs on
`feat/wrap-a-native-token`. A `build`, `ci` or `perf` change goes on a `chore`
branch.

A commit message here says what changed, not who changed it: no attribution
trailers, and no address belonging to a person.

## Releasing the library

1. In one pull request, set the new version in `packages/library/package.json`
   and move the entries under `[Unreleased]` in `CHANGELOG.md` to a heading with
   that version and the date.
2. Once it is merged, tag the merged commit on `main` with `v` and the version,
   for example `v0.2.0`, and push the tag.
3. The publishing workflow checks the library again and publishes it to npm with
   a provenance statement. It refuses a tag that is not the version the library
   carries, and a tag on a commit that is not on `main`.

A published version cannot be replaced, so a mistake is fixed by publishing the
next one. While the library is marked private, npm refuses to publish it. npm
trusts this workflow to publish only a package that already exists on the
registry, so the first version is published once by other means and every later
one by the steps above.

## Reporting something that could lose money

Report it privately rather than in an issue, and read SECURITY.md first: this
contract is immutable, so a defect found after a deployment cannot be fixed in
that deployment.
