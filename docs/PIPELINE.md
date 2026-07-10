# The pipeline — how SAM's CI/CD works

Everything runs on GitHub's free tier (public repo = unlimited Actions incl. macOS) + GitHub Pages + one self-hosted Mac for the GUI/signing jobs. £0, forever.

## Workflows

| Workflow | Trigger | Runner | Does |
|---|---|---|---|
| **CI** (`ci.yml`) | push/PR → main | ubuntu | `npm test` + `tsc` + `build` (3-OS matrix) |
| **Build Desktop** (`build-desktop.yml`) | release published · dispatch | mac/win/ubuntu (hosted) | signed+notarized installers → release, checksums, install-test, brew-cask bump |
| **Overlay E2E** (`overlay-e2e.yml`) | push main/release · dispatch | macOS (→ self-hosted gui) | real Electron overlay test |
| **Secret scan** (`secret-scan.yml`) | push/PR · dispatch | ubuntu | gitleaks over full history |
| **CodeQL** (`codeql.yml`) | schedule · dispatch | ubuntu | static security analysis |
| **Pages** (`pages.yml`) | push (docs) | ubuntu | rebuild + deploy the landing site |

## 🔒 Self-hosted runner security (public repo — non-negotiable)

The self-hosted macOS runner lives on a **personal Mac that holds the code-signing archive** (`~/sam-signing`). On a *public* repo, a self-hosted runner is a prime target: a stranger's **fork pull request** can execute arbitrary code on the runner host. Two layers close this:

1. **No `pull_request` trigger on any self-hosted job.** Self-hosted jobs trigger **only** on `push` to our own branches (forks can't push to the repo) + `workflow_dispatch` (maintainer-only). Never `pull_request`. Enforced today: `overlay-e2e.yml` already dropped its `pull_request` trigger before moving to the runner.
2. **Repo setting:** Settings → Actions → General → *Fork pull request workflows from outside collaborators* → **"Require approval for all outside collaborators."**

Hosted runners (ubuntu/macos-latest) are ephemeral + isolated, so fork-PR code on them is the normal, safe GitHub model — the lock applies only to self-hosted.

## Registering the self-hosted Mac runner (v1.6 Phase 1)

1. github.com/richhabits/sam → Settings → Actions → Runners → **New self-hosted runner** → macOS / ARM64.
2. Run the download + `./config.sh --url … --token …` blocks it shows. Labels: `self-hosted, macOS, gui`.
3. **Run it as a background service** (survives reboots — CI never waits on you): `./svc.sh install && ./svc.sh start` (not `./run.sh`).
4. Apply the two security layers above **before** it goes live.
5. Then move `overlay-e2e.yml`'s `runs-on` to `[self-hosted, macOS, gui]`, flip `continue-on-error: false`, and add the demo-recording + per-OS-screenshot jobs (same trigger rules).

## Speed + cost (targets)

- **Caching**: `actions/cache` for npm, Electron binaries, Playwright — PR CI < 8 min, release build < 20.
- **No wasted runs**: `concurrency` groups (auto-cancel superseded runs), path filters (docs-only skips builds), draft PRs skip heavy jobs.
- **Green means green**: any intermittently-failing job is fixed or quarantined-with-an-issue within the phase — never an ignored red ✗ on main.
