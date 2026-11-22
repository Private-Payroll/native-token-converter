# Changelog

The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the client library
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from its first release.

There has not been a release yet. The library in `packages/library` is marked private and nothing has
been published, so this file starts here rather than with a history of releases that did not happen.
The changes before it are the pull requests on `main`.

## [Unreleased]

## How an entry is written

One line per change, in the words of somebody using the contract or the library: what is different
for them, not the commit subject. Each goes under `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`
or `Security`, and anything that changes what a wrap or a redemption does, or what it discloses, goes
under `Security` as well, so somebody deciding whether to upgrade does not have to infer it. An entry
names its pull request, never a person.

A new contract is a new deployment, not an upgrade: deployed with no maintenance authority, as it is
meant to be, the deployed one cannot change. An entry for a change to the contract says so, and says
what happens to notes wrapped by the one before.
