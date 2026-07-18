# Stripping SwiftLint — NEXT (wrong language, and the idea's already covered)

*Source: [realm/SwiftLint](https://github.com/realm/SwiftLint) — MIT, a linter that enforces
Swift style/conventions. 200+ SwiftSyntax-AST rules, `--fix` autocorrect, `.swiftlint.yml`
config, Xcode/CI/pre-commit integration. Actively maintained. Its own docs: "strictly
Swift-specific — no language-agnostic functionality."*

## Verdict: NEXT — for both, no hesitation

- **SAM** is TypeScript/Node + React on electron. **No Swift anywhere** — the "iOS companion"
  is a folder-sync trick (`docs/ios_companion.md`), not a Swift app; `sam-signing` is
  electron code-signing, not Swift. A Swift-only linter has literally no files to lint.
- **FLIP IT** is Python. Same story.

So there's nothing to build, take, or bump. The tool is excellent — it's just for a language
neither codebase contains.

## The two ideas it embodies are already handled for the languages we *do* use

1. **Rule-based lint + autocorrect** → SAM already has **biome** for TS; flip-it's Python could
   use **ruff** (a fair standalone note, but that's ruff, not SwiftLint).
2. **Lint output → diff-scoped PR comments in CI** → already the **reviewdog** finding from the
   last batch (`FOURPACK_STRIP.md`). SwiftLint would just be one more linter feeding that pipe —
   *if* there were Swift to feed it.

## The only future where this matters

If SAM ever ships a **native SwiftUI macOS/iOS app** (instead of electron + the folder
companion), SwiftLint becomes the standard linter to adopt, wired through the same reviewdog
CI pattern. Filed for that hypothetical; nothing to do today.

## BOARD paste block

```
- SwiftLint stripped (SWIFTLINT_STRIP.md): NEXT — Swift-only linter; SAM is TS/electron, flip-it
  is Python — no Swift in either. Its ideas (rule-lint+autofix; lint→PR-comments) are already
  covered by biome / (ruff for py) / reviewdog. Only relevant IF SAM ever ships a native SwiftUI
  app. Zero code. FLIP IT: nothing.
```
