# SAM launch checklist

Ordered so momentum compounds: a signed release + live README/site first, then the channels in the
order that historically drives the cleanest traffic. Everything below is drafted in this folder.

## T-1 day — make sure the product is airtight
- [ ] Signed release live (`spctl`/`stapler` green in CI) — or the honest unsigned+checksums path is clearly explained.
- [ ] One-paste install verified on macOS + Windows + Linux (the `install-test` CI job is green).
- [ ] README hero GIF renders; the one-liner copies correctly; star CTA visible above the fold.
- [ ] Landing page (richhabits.github.io/sam) shows current stats + checksums + one-liner.
- [ ] `docs/stats.json` truthful; badges match.

## Launch day (Tuesday, ~9:00am US Eastern — best HN window)
1. [ ] **Show HN** — post `show-hn.md`. Be present in the thread all day; reply fast, humble, technical.
2. [ ] **Product Hunt** — schedule `product-hunt.md` for 12:01am PT the same day; first comment ready.
3. [ ] **Reddit** — `reddit.md`: r/LocalLLaMA first (best fit), then r/selfhosted a few hours later.
4. [ ] **X/Twitter** — post the `x-thread.md` thread; pin it; quote-tweet the HN link.
5. [ ] **Awesome-list PRs** — submit the entries in `awesome-submissions.md` (one PR per list, real value framing).

## After
- [ ] Respond to every issue/comment within a few hours for the first 72h.
- [ ] Turn the top 3 recurring questions into README FAQ + good-first-issues.
- [ ] Post a "week 1: what happened" follow-up if traction warrants.

## Tone rules (all channels)
- Lead with the **one true hook**: *free, private, local, does the work — one paste to install.*
- Never overstate. Numbers come from `stats.json`. Say "unsigned, here's the checksum" openly.
- It's a solo/indie project by HECTIC — that honesty is an asset, not a liability.
