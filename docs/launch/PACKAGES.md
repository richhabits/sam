# Package-manager submissions (winget · Flathub)

SAM already ships via **Homebrew cask** (`brew install --cask richhabits/tap/sam`, auto-bumped each release). These are the prepped submissions for the other two big managers. Manifest templates live in `packaging/`; `scripts/bump-packages.mjs` fills them from a release's assets into `packaging/out/`.

## Release-workflow hook (auto-bump)
After the installers + `SHA256SUMS.txt` are attached to a release, run:
```bash
INSTALLER_SHA256=<win .exe sha> APPIMAGE_SHA256=<linux .AppImage sha> \
  node scripts/bump-packages.mjs --version <X.Y.Z>
```
This writes ready-to-submit manifests to `packaging/out/{winget,flatpak}/`.

## winget (Windows) — one-time then automatable
1. Fork `microsoft/winget-pkgs`.
2. Copy `packaging/out/winget/*` → `manifests/h/HECTIC/SAM/<X.Y.Z>/`.
3. Validate: `winget validate manifests/h/HECTIC/SAM/<X.Y.Z>` and `winget install --manifest ...` locally.
4. PR to `winget-pkgs`. Once accepted, future versions can be auto-PR'd with the `wingetcreate` GitHub Action using the filled installer manifest.
- **Prereq**: the Windows installer must be a stable public URL (the GitHub release asset is fine). Unsigned is accepted by winget; a code-signing cert removes the SmartScreen prompt (see docs/SIGNING.md).

## Flathub (Linux) — one-time review, then auto-updates
1. Fork `flathub/flathub` (new-submission branch).
2. Add `packaging/out/flatpak/com.hectic.sam.yaml` (+ the `.desktop` and `.metainfo.xml`).
3. Test the build locally:
   ```bash
   flatpak-builder --user --install --force-clean build-dir packaging/out/flatpak/com.hectic.sam.yaml
   flatpak run com.hectic.sam
   ```
4. Open the submission PR. After the initial review, add the **Flathub external-data / update bot** (`flatpak-external-data-checker`) so new AppImage releases are picked up automatically.
- **Note**: wrapping the prebuilt AppImage is the fast path. A from-source Flatpak build is the longer-term ideal (Flathub prefers it) — tracked for v1.6.

## Checklist before submitting
- [ ] `LICENSE` is MIT and referenced in both manifests (done in v1.5).
- [ ] Installer/AppImage URLs resolve and SHAs match `SHA256SUMS.txt`.
- [ ] Screenshots + a 64px icon are attached (Flathub requires the icon + metainfo screenshots).
