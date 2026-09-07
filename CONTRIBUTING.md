# Contributing

## What gets checked

`npm run verify` compiles the contract, checks that every path this repository
cites is in it, checks that what is in the tree is exactly what this repository
publishes, typechecks, and runs the tests. The workflow runs all of that, plus
two things that need a pull request to exist: what git is tracking against the
same publish list, and the pull request's own title, body and branch name held
to what a commit message has to be.

That last check assumes this repository squashes with **Pull request title and
description** as the commit message, which is what makes the title the subject
and the body the body.

## Naming a change

A pull request title becomes the commit subject when the branch is squashed, so
the title is held to what a subject line has to be, and the workflow fails the
pull request if it is not:

```
kind: what changed
```

- **kind** is one of `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`,
  `refactor`, `test`. An optional scope goes in brackets: `fix(redeem): ...`.
- What changed is lower case, imperative, and does not end with a full stop.
- The whole subject is at most 72 characters.

The branch name follows from the title: `feat: wrap a native token` belongs on
`feat/wrap-a-native-token`. It is checked too, because it stays on the pull
request page after the branch itself is gone.

`scripts/commit-check.ts` is the file the workflow runs to do all of that, and
you can run it yourself on anything you are about to write:

```
npx tsx scripts/commit-check.ts <file>
```

It prints the branch the change belongs on, or says what is wrong with the
message and refuses.

A commit message here says what changed, not who changed it: no attribution
trailers, and no address belonging to a person.

## Reporting something that could lose money

Report it privately rather than in an issue, and read SECURITY.md first: this
contract is immutable, so a defect found after a deployment cannot be fixed in
that deployment.
