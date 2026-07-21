# Contributing to SAM

Short version: **SAM is source-available, and external code contributions are not being
accepted.** The source is published so it can be read, reviewed and audited — not so it
can be forked and rebuilt. See [LICENSE](LICENSE) for what that permits.

That is a deliberate choice rather than an oversight, and it is worth being plain about
why: SAM is built and owned by Hectic Radio Ltd, and accepting outside code would mean
either taking assignment of other people's copyright or ending up with a codebase nobody
can cleanly own. Neither is a mess worth creating.

## What genuinely helps

Three things, all of them valuable and none requiring a pull request:

**Report a bug.** Open an issue with what you did, what you expected, and what happened.
A clear reproduction is worth more than a patch.

**Report a security issue — privately.** Do **not** open a public issue. Use GitHub's
Security tab → *Report a vulnerability*. See [SECURITY.md](SECURITY.md).

**Say what is missing.** Feature requests and honest criticism of how SAM behaves are
read and taken seriously. "This asked me three times for something obvious" is a useful
report.

## If you want to suggest a change to the code

Describe it in an issue rather than sending a diff. If it's the right change, it gets
made and credited. If you'd like to discuss something larger — a partnership, a licence
to build on SAM, or commercial use beyond running an official build — ask:
richhabitslondon@gmail.com

## Packs and skills

Packs and skills are the parts designed to be extended, and they live in their own
repository under their own terms:
[`richhabits/sam-packs`](https://github.com/richhabits/sam-packs). Building one there
does not require any licence to SAM's own source.

## Reading the source

You are welcome to. It is meant to be read: every non-obvious decision carries a comment
explaining *why*, and the tests are written to be read as documentation of what the code
guarantees. If something is unclear, that is a fair thing to raise in an issue.
