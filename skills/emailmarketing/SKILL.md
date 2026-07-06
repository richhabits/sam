---
name: Email Marketing
tier: free
triggers: newsletter, email campaign, mailing list, subject line, open rate, click rate, broadcast, drip, sequence, welcome sequence, deliverability, klaviyo, mailchimp, email blast, unsubscribe
---

# Email Marketing skill

This skill makes SAM the user's email marketer. When they ask to "write the newsletter", "build a welcome sequence" or "fix the open rates", you write emails a human actually reads, structure sequences that convert, and guard deliverability so the mail lands in the inbox — not spam. Write for the user's brands (from their vault).

## Goal
Get the right email to the right list at the right time — opened, read, clicked — without torching sender reputation.

## Operating frame
- Email is **permission earned, not attention stolen**. One person, one idea, one action per send.
- The funnel is **delivered → opened → clicked → converted**. Diagnose at the stage that's actually leaking.
- A smaller engaged list beats a big dead one. Protect the list, don't just grow it.

## Step 1 — Know the job
1. What's the send: broadcast (one-off) or sequence (automated series)? Who's the segment?
2. One goal per email — reply, click, buy, book. If you can't name it, don't send it.

## Step 2 — Write it
1. **Subject line: write 3–5 variants**, 30–50 chars, curiosity or clear benefit, no spammy caps/ALL-CAPS/excess punctuation. This decides the open.
2. **Preview text** as a second hook, not a repeat of the subject.
3. Body: short, scannable, conversational, written to one reader. Front-load value. **One primary CTA** (a second link at most).
4. Sequences — a solid default welcome flow: (1) deliver the promise/welcome, (2) story + credibility, (3) useful value, (4) soft offer, (5) direct offer + deadline. Space 1–3 days apart.
5. Pull live facts/offers with `web_search`/`web_fetch`; draft to a file with `write_file`, or stage with `draft_email` (ask-first — SAM won't send without a yes).

## Step 3 — Deliverability
- Keep it honest: real from-name, working unsubscribe, no bait subjects. Balance text-to-link, avoid spam-trigger phrasing.
- Warm new senders slowly; prune hard bounces and long-dead unopens — they drag reputation down.

## Step 4 — Measure & iterate
Benchmarks to steer by (vary by industry — treat as rough): **open ~30–45%, click ~2–5%, unsubscribe <0.5%**. Low opens → subject/sender/deliverability. Good opens, low clicks → offer or CTA. Rising unsubscribes → too frequent or off-topic. Test one variable at a time; log wins with `remember_fact`.

## Quality bar
Deliverable ships with: 3+ subject options, preview text, a scannable body with one CTA, suggested send timing, and the one metric to watch.

## Don't
- Don't send without approval, and never email people who didn't opt in.
- Don't fake urgency or clickbait subjects that under-deliver — it kills trust and deliverability.
- Don't send to a whole list what belongs to one segment.
