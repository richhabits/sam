# SAM launch gates (auto-prep status)

## Done without you
- PR #118 merged (CodeQL error-class fixes, landing Apple Silicon honesty, iPhone 6.9 sizes)
- Landing regenerated; Pages deploy succeeded
- ATS honesty fixed in mobile/SUBMISSION.md
- APP-REVIEW: ASC app record noted as existing (build 1.0.0/7)
- Webhook SSRF path now uses safeFetch (local commit 85ec102 — needs push)
- CodeQL alert #147 fixed; #158 pending push/reanalyze or dismiss

## In progress
- Native iPhone 6.9 screenshots on SAM Test Max (Debug sim build; machine was RAM-starved)

## Needs you (cannot fully automate)
1. **App Store Connect** — age rating questionnaire, upload screenshots, Submit for Review (ASC UI; Issuer ID for API not found on disk)
2. **Confirm GitHub release 3.6.1** publish once signed Mac/Win/Linux artifacts built (auto-update ship)
3. **ASC API Issuer ID** — paste once so future metadata/screenshot uploads can be API-driven (AuthKey_*.p8 present)

## Do not need you for
- More check-ins on what to do next
