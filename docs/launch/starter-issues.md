# 5 starter issues (good-first-issue)

Real, scoped, genuinely helpful — not busywork. Ready to create with `gh issue create`.

1. **Add a `--version` / `sam version` output to the CLI entry**
   Small, self-contained; teaches the repo layout. Label: good-first-issue, cli.

2. **Package matrix: publish a Linux `.deb` alongside the AppImage**
   The build config already lists `deb`; wire it into `build-desktop.yml` + install.sh. Label: good-first-issue, packaging.

3. **First-run: detect low RAM and skip the Ollama suggestion gracefully**
   Add a RAM check so weak machines get the key wizard instead of a heavy local-model nudge. Label: good-first-issue, onboarding.

4. **Add 3 more free providers to the key wizard (with live validation)**
   Extend `KeyWizard.tsx` + the `KEY_TEST` map; verify current free tiers. Label: good-first-issue, providers.

5. **Docs: record the demo GIF via the pipeline and embed it in the README hero**
   Run `scripts/record-demo.mjs`, commit the artifact, wire the README. Label: good-first-issue, docs.
