# Strip records — what was taken from other repos, and what wasn't

One file per repo assessed. These are the permanent record of a decision, not an inbox: each
says what the source was, what (if anything) SAM or FLIP IT took, and — more often — the reason
it was declined. **The declines are the point.** A high refusal rate is the process working, the
same logic as a gate that rejects most candidates.

Landed from these: `server/webintel.ts` + `webintel-extract.ts` (wigolo/llm-scraper ideas,
clean-room), `server/colosseum-significance.ts` (PostHog Experiments), `skills/buildx`,
`skills/codeaudit`, `~/flip-it/tools/blastradius.py` (code-review-graph), and freqtrade's
protections/filters in flip-it. Everything else was declined with a reason.

Duplicated artifacts have been deleted here — the live copy is the only copy, so there is
nothing to drift out of sync.
