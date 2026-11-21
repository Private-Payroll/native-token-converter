# Contributing

## What gets checked

`npm run verify` checks the formatting, compiles the contract, builds the client
library, checks that every path this repository cites is in it, typechecks, and
runs the tests. `npm run format` fixes the formatting. The
workflow runs the same command on every pull request, along with static
analysis and a review of any dependency the pull request adds.

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

## Reporting something that could lose money

Report it privately rather than in an issue, and read SECURITY.md first: this
contract is immutable, so a defect found after a deployment cannot be fixed in
that deployment.
