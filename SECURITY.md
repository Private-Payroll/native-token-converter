# Reporting something that could lose money

This contract is immutable once deployed. There is no administrator, no pause,
and no upgrade path, so a defect found after a deployment cannot be fixed in
that deployment. It can only be replaced, and every holder has to move.

That is why this page exists rather than a line in a contributing guide: the
route has to be findable by somebody who has just found a way to destroy other
people's money and has not read anything else here.

## How to report

Use GitHub's private vulnerability reporting on this repository. Open the
Security tab and choose to report a vulnerability.

Private reporting is turned on. The report is visible only to the maintainers,
it carries a full description rather than a request to be contacted, and it
gives you a thread to answer questions in. It asks you to trust GitHub rather
than an address on a page, which is one fewer thing to get wrong.

Please do not open a public issue for anything that could lose somebody money,
including one that says only that you have found something. On an immutable
contract with no pause, the gap between a public hint and a fix is a window in
which the defect is known and nothing can be done about it.

## What to expect

**There is no bug bounty.** Nothing is paid for a report. This is a primitive
published for other people to use, not a funded programme, and saying so here
is better than letting you find out after the work.

**A fix may be a different contract.** The deployed code cannot change. So a
report that lands may result in a replacement being published and the old
deployment being named as one nobody should wrap into, rather than in a patch.
That is slower and more disruptive than a fix, and it is the reason a report
is worth making early.

**A report may be about what the contract does not decide.** The README sets
out what a wrapped note does not tell whoever accepts it. Something working as
described there is still worth reporting if the description is what is wrong:
a document that misleads a holder about what backs a note can cost the same
money as a defect in a circuit.

**What you will hear back.** An acknowledgement in the reporting thread, and
then either what is being changed or why it is not. If a replacement is
published, the report is credited in it unless you ask otherwise.

## What is in scope

The contract in `contracts/src`, the checks in `src` and `scripts` that decide
what this repository claims about itself, and the documentation where it
describes what the software does.

The pinned compiler and the packages this repository depends on are other
people's, and are best reported to them. If a defect in one of them changes
what this contract does, that is in scope here as well.
