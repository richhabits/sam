# 72-hour post-launch triage

The first three days decide whether launch traffic converts or bounces. Your job: **conversation, not
firefighting.** The automation (built in v2.1) absorbs the repetitive load so you can. Here's the split.

## What the machine handles (so you don't)
- **Setup questions** → issue `config.yml` diverts them to the in-app "SAM isn't working?" check +
  `docs/TROUBLESHOOTING.md`. Most "it doesn't work" resolves itself.
- **Malformed/unsafe pack PRs** → the pack-validation gate blocks them automatically.
- **Repo health** → the daily watchdog opens an issue if anything breaks under load.
- **Stranger PRs** → fork rules + required CI keep them safe to merge on review.

## What only you can do — in priority order
1. **Reply in the HN + Reddit threads.** For the first ~6h this is *the* job. Speed + honesty rank you.
2. **Triage real bugs fast.** A real bug found live → fix on main, reply "fixed, thanks." That story sells
   better than any feature.
3. **Watch activation, not vanity.** Stars feel good; what matters is: are people getting to a first
   successful task? If setup issues cluster, fix that one thing immediately — it's your leak.

## What to watch (dashboard in your head)
| Signal | Where | Green | Red → act |
|---|---|---|---|
| HN rank / comment tone | the thread | climbing, curious | sliding, hostile-unanswered → reply faster |
| New issues | GitHub | mostly routed to help | same setup failure repeating → fix + doc it |
| Crash reports / "doesn't work" | issues + diag bundles | rare | a common failure mode → hotfix + `TROUBLESHOOTING.md` |
| Installs vs. activation | (once telemetry deployed) | activating | installing but not activating → your #1 fix |
| Pack PRs / Show-and-tell | Discussions | any | — (each one is free growth) |

## Response cadence
- **0–6h:** near-real-time in the launch threads. Everything else waits.
- **6–24h:** clear the issue queue; hotfix anything blocking activation (ship a patch like v1.8.1 if needed).
- **24–72h:** reply to Discussions, thank contributors, file the awesome-list PRs, write down the top 3
  requested things (that's your next roadmap).

## The one mindset
You cannot out-build a bad first impression, and you cannot out-automate a conversation. The machine keeps
SAM *healthy*; only you make people *care*. Spend the 72 hours where the value is: talking to the humans who
just showed up. Then rest — the watchdog's still watching.
