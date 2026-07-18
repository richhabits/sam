# Stripping wigolo — what's it got for us?

*Source: [KnockOutEZ/wigolo](https://github.com/KnockOutEZ/wigolo) — AGPL-3.0-only, Node 20+.
"Local-first web intelligence over MCP — no keys, no cloud, no metered bill." An MCP server
giving agents 10 web capabilities (search with rank-fusion + ML rerank, fetch with HTTP→browser
escalation, crawl, extract, semantic cache, find_similar, research with cited synthesis,
autonomous agent loops, diff/watch) — all on-device (SQLite FTS5 + sqlite-vec, Playwright,
BGE-small embeddings, MiniLM reranker). ~1.5 GB (browser + models). Public beta.*

## Verdict: a real fit for SAM — but *connect* it, don't *port* it

This is the most on-SAM's-brand repo in the whole strip run. SAM's positioning is literally
"free brains, no metered bill, local-first" — wigolo is that, for web research, and it speaks
**MCP**, which SAM already connects to natively (`server/mcp-presets.ts`). It even needs **no
API keys**, which almost nothing else in SAM's preset list can say. So the answer to "what's it
got for us" is: **a ready-made, key-free, local web-research capability SAM gains by connecting
to it — not by absorbing a line of its code.**

## The load-bearing finding: AGPL-3.0 → connect, never vendor

wigolo is **AGPL-3.0-only**. SAM is MIT and is distributed. That combination has exactly one
safe shape:

- ✅ **Connect to it as an external MCP server** (SAM launches `npx wigolo mcp` as a *separate
  process* and talks JSON-RPC over stdio). This is arms-length use across a protocol boundary —
  the same as SAM talking to Postgres or shelling to a CLI. SAM ships **no** wigolo code, doesn't
  modify it, doesn't link it. AGPL's obligations stay with wigolo; **SAM's MIT stays clean.**
- 🚫 **Do NOT vendor, fork, copy, or bundle** wigolo's source into SAM's repo, and don't ship a
  modified wigolo as part of SAM's service. That's where AGPL's copyleft (and its network-service
  clause) would reach into SAM. The MCP boundary is the firewall; crossing it into the codebase
  breaks the firewall.

That single distinction is the most valuable thing in this strip — it turns "great tool, wrong
license" into "great tool, connect it." (Not legal advice; for anything beyond connecting to the
unmodified package, read the AGPL terms.)

## What SAM takes: a drop-in MCP preset (key-free)

`server/mcp-presets.ts` is a list of `McpPreset` objects. wigolo slots in as a **community,
no-key** preset — the first entry whose `fields: []` genuinely means *nothing to configure*:

```ts
// add to MCP_PRESETS in server/mcp-presets.ts (under a "🔎 Research / web" group):
{ id: "wigolo", label: "wigolo (local web)", emoji: "🌐", official: false,
  note: "local-first web search/fetch/crawl/research — no keys, no cloud, cached offline (AGPL server, run separately)",
  command: "npx", args: ["-y", "wigolo", "mcp"], fields: [],
  docs: "https://github.com/KnockOutEZ/wigolo" },
```

Two honest caveats to surface in the UI note/first-run:
- **First run:** `npx wigolo init` downloads ~1.5 GB (headless browser + ML models). Worth a
  one-line heads-up so it isn't a surprise.
- **`official: false`** — community package; SAM already marks these "verify the package," which
  is right here.

Format verified against the actual `mcp-presets.ts` (`{id,label,emoji,note,official,command,args,
fields,docs}`). I have **not** run wigolo itself (it needs the user's machine + 1.5 GB); this is
a connect-recommendation evaluated from its docs, not a benchmarked one. Wiring the object in is
a one-line additive edit to a shared `server/` file — left as the reviewed step, not done here.

## Ideas worth noting (design, not code)

Even without touching the code, two of wigolo's patterns are good references for SAM's *own* web
tools (`jina.ts`, fetch/search): the **per-domain learning fetch router** (escalate HTTP →
TLS-impersonation → headless browser only when needed, and remember which domains need what), and
**verbatim excerpts pinned to byte-offset source spans** (anti-hallucination: every quoted claim
traces to an exact source span). SAM doesn't need to adopt wigolo to borrow those ideas.

## FLIP IT: nothing — and for a principled reason

A web-research tool is *anti-aligned* with FLIP IT by design. The constitution has Simple Sam
**not chase news** — decisions come from daily bars and proven strategies, not from scraping the
web. wigolo's diff/watch could technically watch a data page, but flip-it's data is market-data
APIs (yfinance/stooq), and adding a web-research surface would invite exactly the news-chasing the
rules forbid. So: correctly nothing.

## Binned

Nothing to bin structurally — the whole thing runs as an external server. The only "don't" is the
one above: don't pull its AGPL code across the MCP boundary into SAM's repo.

## BOARD paste block

```
- wigolo stripped (WIGOLO_STRIP.md): most on-brand repo in the run — local-first web-intelligence
  MCP, "no keys/cloud/bill." Fit = CONNECT as external MCP, never vendor (AGPL-3.0: the MCP
  process boundary keeps SAM's MIT clean; copying its code in would not). Deliverable: a drop-in
  key-free preset for server/mcp-presets.ts (format-verified; 1-line additive, reviewed step —
  not wired). First run pulls ~1.5 GB (browser+models); marked official:false. Design ideas worth
  borrowing for SAM's own web tools: per-domain fetch-escalation router, byte-offset-pinned
  excerpts. FLIP IT: nothing, by design (constitution bans news-chasing).
```
