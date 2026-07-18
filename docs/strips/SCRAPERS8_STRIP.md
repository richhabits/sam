# Stripping 8 scrapers — one build, the rest mapped honestly

*Romeo's list: Firecrawl · Crawl4AI · Browser-use · Crawlee ("logins crawley") · Scrapy
("scrapie") · Scrapling · AutoScraper · curl-impersonate. All in the fetch/scrape/crawl/anti-bot
space — the exact territory of SAM's webintel stack. Verdict per repo, then the build.*

## Scoreboard

| Repo | What it is | License | Verdict for SAM |
|---|---|---|---|
| **Firecrawl** | site → LLM-ready markdown; **crawl + map** | AGPL-3.0 | idea BUILT (crawl+map). AGPL = couldn't vendor anyway |
| **Crawl4AI** | async crawler → markdown; **deep-crawl BFS/DFS**; LLM extract | Apache-2.0 | crawl BUILT; extract already ours; JS-render = next |
| **Crawlee** (apify) | crawler framework: queue, proxies, browser pool, **login/session** | Apache-2.0 | crawl-queue BUILT; login/session = note |
| **Scrapy** | classic heavyweight Python crawl framework | BSD | don't vendor (Python, heavy); crawl covers SAM's need |
| **Browser-use** | LLM **agent drives a real browser** (Playwright) | MIT | SAM already has this (Chrome MCP) → adopt/covered; own Playwright build = next |
| **curl-impersonate** | curl with **browser TLS/JA3 fingerprints** (anti-bot) | MIT | TLS part not remakeable in Node; header-lite = small follow-up |
| **Scrapling** | **adaptive selectors** + stealth | BSD-3 | adaptive = already ours in spirit (LLM extract needs no selectors); stealth = next |
| **AutoScraper** | learn scrape rules **from examples** | MIT | already ours in spirit (LLM extract supersedes example-learning) |

## ✅ BUILT — the crawl/map core (Firecrawl + Crawl4AI + Crawlee, common core)

Four of the eight center on the one thing webintel didn't have: **follow links across a whole
site**. So I built it — `server/webintel-crawl.ts`, on our own `fetchClean`, **no Playwright, no
framework, ~90 lines**:
- **`crawl(url, {maxPages, maxDepth, sameDomainOnly})`** — same-domain BFS → clean pages, with
  depth/page limits, a polite inter-request delay, and **robots.txt respected** (we crawl like a
  good citizen, not a hammer).
- **`mapSite(url)`** — Firecrawl's "map": discover the same-domain URLs reachable from a page.

Verified live (`incoming-cowork/webintel-crawl.verify.mjs`, **6/6**): mapped 60 same-domain URLs;
crawled 3 real Wikipedia pages (Web scraping → Data scraping → Scraper site), BFS queue discovered
118, all same-domain, clean text, **honoured 428 robots rules**. Typecheck-clean, CI-safe test.

## Already ours in spirit (the clever ones we don't need to copy)

- **AutoScraper** (learn rules from examples) and **Scrapling** (adaptive selectors that self-heal
  when a site changes) solve *selector brittleness*. Our `webintel-extract` sidesteps that
  entirely: it uses **no selectors** — the LLM reads the cleaned page against a schema, so a
  layout change doesn't break it. We got the resilience by a different, arguably better road.

## Honest nexts (heavy deps / not Node-remakeable)

- **JS rendering / browser escalation** (Crawl4AI, Firecrawl "interact", Browser-use): needs a
  real browser (Playwright) — a genuine dependency + resource cost. **SAM already has browser
  control via the Chrome MCP**, so agentic browser tasks are *covered by adoption*, not a rebuild.
  A dedicated headless-render step for JS-only pages stays on the roadmap, gated on wanting the dep.
- **Anti-bot / TLS-JA3 impersonation** (curl-impersonate, Scrapling stealth): true TLS fingerprint
  spoofing needs native BoringSSL/nss control — **not remakeable in plain Node.** The *takeable*
  slice is header-level impersonation (realistic UA + `Accept*` + `Sec-*` headers), a ~10-line
  follow-up to `fetchClean` — real but modest; it won't beat Cloudflare, and pretending otherwise
  would be dishonest.
- **Scrapy / Crawlee frameworks**: heavy, Python/Node scraping *platforms*. SAM doesn't need a
  platform — it needs the lean capability, which is now the webintel stack. Login/authenticated
  crawling, if ever needed, routes through the Chrome MCP (real session) rather than a framework.

## The webintel stack now (all ours, all lean, one composable line)

`webintel` (read + cache) → `webintel-extract` (one page → schema) → `webintel-research`
(many pages + search→aggregate) → **`webintel-crawl` (whole site + map)**. Four increments,
clean-room, zero npm deps, each verified live. Roadmap left: JS render (needs Playwright) ·
header-impersonation lite · on-device embeddings for semantic cache.

## FLIP IT

Nothing — web crawling stays out of the mechanical rig (constitution: market-data APIs, not the web).

## BOARD paste block

```
- 8 scrapers stripped (SCRAPERS8_STRIP.md): Firecrawl/Crawl4AI/Crawlee/Scrapy/Browser-use/
  curl-impersonate/Scrapling/AutoScraper. BUILT the common core → `server/webintel-crawl.ts`
  (crawl + map: same-domain BFS on our fetchClean, depth/page limits, polite delay, robots.txt
  respected; no Playwright/framework; 6/6 live-verified, typecheck-clean, CI test). Already-ours:
  AutoScraper/Scrapling (LLM-extract needs no selectors → self-healing for free). NEXTS: JS render
  /browser (Playwright dep — SAM already has Chrome MCP for agentic browsing) · TLS-JA3 anti-bot
  (not Node-remakeable; header-lite is a ~10-line follow-up) · Scrapy/Crawlee frameworks (heavy,
  unneeded). webintel stack now: read+cache → extract → research → crawl, all ours. FLIP IT: none.
```
