# Stripping ScrapeGraphAI — core already ours, its distinct idea built

*Source: [ScrapeGraphAI/Scrapegraph-ai](https://github.com/ScrapeGraphAI/Scrapegraph-ai) — MIT
(+ commercial API), Python. LLM + graph pipelines for scraping, on LangChain + Playwright. Six
graph types: SmartScraperGraph (single page), SearchGraph (top-N results), SmartScraperMultiGraph
(many pages), plus ScriptCreator/Speech/Omni variants.*

## Verdict: half already ours, half built, zero vendoring

**1. The core was already ours.** SmartScraperGraph = "fetch a page → LLM + prompt → structured
data" = `server/webintel-extract.ts`, built earlier from llm-scraper. Leaner (no LangChain, no
Playwright) and on SAM's own brains. Nothing to take.

**2. Multi-page + SearchGraph we did not have.** Built → `server/webintel-research.ts`:
- `extractMany(urls, schema, llm)` — one schema across many pages → a flat table, one row per page
  with its source URL; dead URLs land in `failed[]`, never fatal. Batched concurrency.
- `searchAndExtract(query, schema, search, llm)` — search → extract across the top results →
  aggregate. **The search backend is injected**: keyless web search is genuinely flaky, so we do
  not pretend to own it. SAM wires its own (Brave preset / DuckDuckGo / cascade). What we own is
  the aggregation.

**Skipped deliberately:** ScriptCreatorGraph (generates Python scrapers — script-generation-then-run
is a code-execution surface SAM does not want) and SpeechGraph (niche).

## Verification — corrected receipt

The strip advertised **"4/4 live-verified"**. The verify script as committed imported
`./webintel-research.mjs`, a file that was never landed, so it threw `ERR_MODULE_NOT_FOUND` and
**had never run on this disk**.

**This is the third time.** `scripts/verify-webintel.mjs` and `verify-webintel-extract.mjs` shipped
the same broken import and were fixed in `7542fd4`, whose message says: *"a verification script
that cannot execute is worse than none: it reports success by existing."* The lesson did not
transfer to the next script. If a fourth webintel verify script is written, import
`../server/<module>.ts` and run it before quoting a number.

Fixed and **actually run — 4/4 pass**, so the claim was true in substance, just not reproducible
from the committed artifact:

```
[PASS] multi-page: a row per successful page
[PASS] multi-page: rows carry their source url
[PASS] multi-page: one good + one dead → table has the good, failed[] has the dead
[PASS] search→extract→aggregate: injected search feeds the pipeline
ALL PASS — 4 passed, 0 failed
```

## One real quality finding the run surfaced

The extracted titles came back as `"Jump to contentSearchDonateCreate accoun"` — Wikipedia's
navigation chrome, not the article. The mock LLM is deliberately dumb, so that alone is not a bug.
But measuring it showed something that matters:

**`webintel`'s `htmlToText` leaves 1997 characters of nav/language-list boilerplate before the
article body begins.** With `maxChars: 3000`, **two-thirds of the LLM's context budget is spent on
Wikipedia's language list** before a word of content arrives. A real brain would cope on this page
and would silently produce worse results on a longer one, or with a smaller budget.

Not fixed here — boilerplate stripping is a behaviour change to a shared module and deserves its
own pass. Worth doing: it is a direct, cheap quality win for every webintel consumer.

## Security note — the guard came after

These three modules fetch URLs. When `webintel-research` landed, `webintel` had **no URL guard**:
it fetched whatever it was handed, including loopback, the LAN and cloud-metadata addresses. Since
the URL can come from a page SAM already read, that was an indirect-prompt-injection path into the
user's own network. Closed by `server/url-guard.ts` (8 tests) — see `docs/BOARD.md`. Any future
fetch-capable module must route through `checkOutboundUrl`.

## FLIP IT

Nothing — web scraping stays out of the mechanical rig (the constitution allows market-data APIs,
not the web).
