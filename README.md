# Native token converter

A Midnight contract that takes in an unshielded token and hands back a shielded
note standing for it, and takes that note back and returns the token. Two
circuits, no state of its own, and nobody in charge of it.

It is a primitive rather than a product: anybody may wrap any unshielded token,
and nothing about the contract knows or cares which token that is. That is the
whole of its usefulness and the whole of its cost, and the cost is written out
below rather than left to be discovered.

## What it does

```
wrap(backing, amount, to, nonce) -> ShieldedCoinInfo
```

Takes `amount` of the unshielded token `backing` into the contract and mints
`amount` of the shielded note that stands for it, to `to`.

The returned coin info is the only copy of the minted note. A wallet cannot find
a contract-minted coin by scanning the chain, so whoever builds the transaction
has to deliver it to the recipient out of band. Dropping it strands the value for
good.

`nonce` is yours to choose and yours to get right. It must not repeat for a given
pool, or the ledger rejects the transaction; and it should be secret and random,
because a predictable one makes the mint's recipient guessable. Neither is
checked here.

```
redeem(backing, coin, to) -> ()
```

Destroys `coin` and pays out the same number of units of `backing` to `to`.

A note is redeemed whole. There is no partial redemption: a holder wanting part
of a note splits it first and redeems the part, which costs a second
transaction.

## What this contract cannot decide for you

### A wrapped note says nothing about what backs it

Anybody can wrap anything. If somebody hands you a wrapped note, the loss lands
on you - not on whoever chose the coin, and not on this contract.

Somebody can mint a token in the morning, wrap it here in the afternoon, and pay
you with the note. The pool behind that note is exactly and honestly solvent, in
a token worth nothing. Nothing is wrong on chain, and nothing on chain
distinguishes that note from one backed by a real asset. Resolving a backing
colour to an issuer has no on-chain answer, only a registry, and a contract
cannot put a registry in a stranger's client.

So find out what backs a note before you accept it, from somewhere other than
the note. Any application built on this owes its users that answer; where it
does not give one, its users are carrying a choice somebody else made and cannot
see.

### Whether a minted note can be found is up to the transaction builder

The mint binds a coin public key. The ciphertext a wallet needs in order to find
the coin is a separate field the transaction builder attaches, resolved off
chain, and a circuit has no access to an encryption key. A wrap built by a client
that does not attach it is accepted, correctly minted, and invisible to its owner
for ever.

### One `decimals` ships for every asset, and the contract cannot decline to choose

The token metadata is contract-wide and fixed when the contract is constructed,
while the assets it will accept are not known and do not share a convention. The
value here is `0`, which says the only thing true of all of them: this contract
applies no scaling, so a note's integer value is the backing asset's integer
value, unit for unit. It is not a display convention, and a client that reads it
as one will put the decimal point in the wrong place. Take the decimals from the
backing asset.

## One pool per coin, and nobody chooses it

The colour of the note minted against a backing token is

```
tokenType(backingColour, converterAddress)
```

- a function of the coin being wrapped and of the contract's own address, and of
nothing else. So there is exactly one pool per backing token, the first person to
wrap that token brings its pool into existence, and everybody after uses that
same pool because arithmetic offers no second one. Creating a pool is not an act
with a decision in it, and there is no list of permitted assets, no registry, and
nobody - including whoever deployed the contract - who could add to one.

The same fact does the safety work. `backing` is supplied once per call and
drives both halves: on the way in it is the colour received and the domain minted
against; on the way out it is the domain the note is burned against and the
colour paid out. Burning one pool and paying from another is not a mistake this
contract can make, because it cannot be expressed. The same is true of the
amounts: `wrap` uses one `amount` for what it takes in and what it mints, and
`redeem` has no amount argument at all - it burns and pays the note's own value.

## Two more things worth knowing before you build on it

**Both ends are public.** A wrap discloses the backing colour and the amount; a
redemption discloses the note's token type, the amount and the recipient's
address. That is how the ledger balances a transaction, not a choice made here.
What is private is everything in between: who holds a note, and what they do
with it.

**A holder of nothing but wrapped notes can pay no fee.** Fees are paid in a
resource generated by holding the network's own token, and holding a wrapped note
generates none. Who pays for a redemption is a question every application has to
answer for itself; this contract does not answer it and does not pretend to.

## What it will never have

No administrator, no key held by anyone, no pause, and no upgrade path. Nothing
about a deployment can be changed after it exists, including by whoever deployed
it. The contract never holds anybody's money on their behalf: it holds backing
against notes, and any holder of a note can take that backing out without
anyone's permission.

And no way to recover anything sent to it other than by `wrap`. An unshielded
transfer straight to this address raises a pool's balance with no note against
it, and nothing can ever take it out again.

The other side of immutability: a defect found later cannot be fixed in place,
cannot be paused, and cannot be announced to the people affected, because there
is no record of who they are. A new deployment can be published, but the old one
keeps honouring its notes, because nothing can stop it.

## Using it from a client

The colour derivation is free off chain and would cost an entire circuit on
chain, so the contract does not offer it and clients are expected to compute it.

This is not published to a package registry. It is forty lines of TypeScript in
`src/wrapped-colour.ts`; clone the repository, or copy the file.

```ts
import { isWrappedNoteOf, wrappedColour } from './src/wrapped-colour.js';

// The colour this converter mints against that backing token.
const colour = wrappedColour(backingColour, converterAddress);

// Whether a note in hand came from that converter, for that backing token.
isWrappedNoteOf(note.color, backingColour, converterAddress);
```

That answers one question and not the one a holder usually wants: it says the
note came from that converter and that the converter holds that backing colour
against it. It says nothing about whether the backing colour is worth anything.

## Building it

```
npm install
npm run verify
```

`verify` compiles the contract, checks that every path this repository cites is
in it, typechecks, and runs the tests. The tests run the compiled circuits and
read the ledger effects they produce, so what they check is what the chain would
be asked to do.

The Compact compiler is pinned, and fetched on first use if it is not already
here, so a clone, Node 22 or newer, and `curl` and `unzip` are enough. The pinned
version, and where it comes from, are in `src/toolchain.ts`. There is a pinned
compiler for macOS and Linux only; on anything else the build refuses rather than
guessing, and `COMPACTC` can point at one you installed yourself. Proving keys
are skipped by default because they take minutes and are needed only to deploy or
to prove; `npm run compact -- --with-proving-keys` builds them.

The token module this contract is built from is
[OpenZeppelin Contracts for Compact](https://github.com/OpenZeppelin/compact-contracts),
which is where the burn's check that a note belongs to the pool it is burned
against comes from. **It is an alpha release**, pinned exactly, and it is where
most of the money-handling code in a deployment of this contract comes from.
Read it before you rely on this.

## Licence

Apache-2.0. See `LICENSE`.
