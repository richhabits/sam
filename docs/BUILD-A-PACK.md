# Build a SAM pack

A **pack** (`.sampack`) is a signed, portable bundle of shareable SAM assets: skills (markdown
playbooks), forged tools (code + declared capabilities), prompts, and watched-folder templates. Packs are
how the community extends SAM without touching the repo.

## What's in a pack

```jsonc
{
  "format": "sam-pack/1",
  "meta": {
    "name": "Landlord Pack",
    "description": "Playbooks + tools for property management",
    "author": "you",
    "version": "1.2.0",          // v1.8: semver of the pack itself
    "dependencies": ["base-pack"] // v1.8: other packs this one needs (never auto-installed)
  },
  "contents": {
    "skills":  [{ "id": "landlord_helper", "body": "# ...markdown..." }],
    "tools":   [{ "name": "rent_calc", "code": "(i)=>...", "caps": [], "...": "..." }],
    "prompts": [{ "title": "Late-rent notice", "text": "..." }],
    "watchedTemplates": []
  },
  "publicKey": "<base64>",   // your per-install Ed25519 key
  "sig": "<base64>"          // signature over the canonical meta+contents
}
```

`version` and `dependencies` are part of the **signed** bytes — tampering breaks the signature.

## Create one

- From inside SAM: **Export a pack** picks the skills/tools/prompts you choose and signs it with your
  local key. Share the file.
- The signing key lives only on your machine; the public key travels in the pack so anyone can verify
  authorship. There is no server.

## Import safety — the promise to whoever installs your pack

Importing a pack **never auto-installs anything**. Every included tool is re-run through the **full forge
safety pipeline** on the importer's machine: static scan → sandbox test → landed **disabled** for review.
Skills install only ones the user explicitly ticks. `dependencies` are surfaced as "you also need X" —
they are **not** fetched or run automatically. So a malicious pack can't smuggle in code: the importer's
gate, not your signature, is what grants trust.

## Publish to the community index

The public index lives at [`richhabits/sam-packs`](https://github.com/richhabits/sam-packs) — a plain
repo, no server. To publish: export your pack, then open a PR adding it + an `index.json` entry
(name, description, author, version, category). CI validates every pack (verifies the signature, re-runs
the safety scan) before merge. Merged packs appear in SAM's in-app gallery and on the site.

## Versioning etiquette

Bump `version` (semver) on every change. Declare `dependencies` by pack name. Keep skills free of
personal data (they're markdown that becomes instruction context). Keep tools minimal-capability — only
declare `net`/`fs:*` if truly needed; both make the tool dangerous-tier.

See also: [BUILD-A-TOOL.md](BUILD-A-TOOL.md) · [SECURITY.md](../SECURITY.md).
