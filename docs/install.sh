#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  SAM — one-paste installer (macOS / Linux)
#    curl -fsSL https://richhabits.github.io/sam/install.sh | bash
#
#  Detects your OS + arch, downloads the correct latest release asset, VERIFIES its SHA-256 against
#  the release checksums (aborts loudly on mismatch), installs it, launches SAM, and prints a banner.
#  Idempotent — re-run any time to update in place. Every failure explains itself + the fix.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REPO="richhabits/sam"
API="https://api.github.com/repos/${REPO}/releases/latest"
# Authenticate the API call ONLY when a token is present (CI, or a corporate proxy). This dodges
# GitHub's unauthenticated rate limit on shared egress IPs. Real installs need no token — a normal
# Mac/PC has ample unauthenticated budget — so behaviour is unchanged for users.
GH_TOKEN_VALUE="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'; ORANGE=$'\033[38;5;208m'; RESET=$'\033[0m'

say()  { printf "%s\n" "$*"; }
step() { printf "${ORANGE}▸${RESET} %s\n" "$*"; }
ok()   { printf "${GREEN}✓${RESET} %s\n" "$*"; }
die()  { printf "\n${RED}✗ %s${RESET}\n" "$1" >&2; [ -n "${2:-}" ] && printf "  ${DIM}fix:${RESET} %s\n" "$2" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl isn't installed." "Install curl and re-run."
curl -fsSL -o /dev/null "https://github.com" 2>/dev/null || die "No internet connection." "Check your network and re-run this command."

printf "\n${BOLD}Installing SAM${RESET} ${DIM}— your private, free AI. Nothing to configure.${RESET}\n\n"

# ── detect platform ──
OS="$(uname -s)"; ARCH="$(uname -m)"
case "$OS" in
  Darwin) PLATFORM="mac";;
  Linux)  PLATFORM="linux";;
  *) die "Unsupported OS: $OS" "SAM installs on macOS, Linux, and Windows (use install.ps1 on Windows).";;
esac
case "$ARCH" in
  arm64|aarch64) ARCH="arm64";;
  x86_64|amd64)  ARCH="x64";;
  *) die "Unsupported CPU: $ARCH";;
esac
step "Detected ${BOLD}${PLATFORM} ${ARCH}${RESET}"

# ── fetch the latest release ──
step "Finding the latest release…"
# (bash 3.2-safe: no arrays — macOS ships bash 3.2, and this may run under `set -u`)
if [ -n "$GH_TOKEN_VALUE" ]; then
  REL="$(curl -fsSL -H "Authorization: Bearer $GH_TOKEN_VALUE" "$API")" || die "Couldn't reach GitHub Releases." "GitHub may be down — try again in a minute."
else
  REL="$(curl -fsSL "$API")" || die "Couldn't reach GitHub Releases." "GitHub may be down — try again in a minute."
fi
TAG="$(printf '%s' "$REL" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
[ -n "$TAG" ] || die "Couldn't read the latest version." "Report this at github.com/${REPO}/issues."

# choose the right asset
if [ "$PLATFORM" = "mac" ]; then
  if [ "$ARCH" = "arm64" ]; then PAT="arm64\\.dmg"; else PAT="[0-9]\\.dmg"; fi   # x64 dmg has no -arm64
else
  PAT="\\.AppImage"
fi
ASSET_URL="$(printf '%s' "$REL" | grep -oE '"browser_download_url": *"[^"]+"' | sed -E 's/.*"(https[^"]+)".*/\1/' | grep -E "$PAT" | head -1 || true)"
SUMS_URL="$(printf '%s' "$REL" | grep -oE '"browser_download_url": *"[^"]+SHA256SUMS[^"]*"' | sed -E 's/.*"(https[^"]+)".*/\1/' | head -1 || true)"

if [ -z "$ASSET_URL" ]; then
  if [ "$PLATFORM" = "linux" ]; then
    die "No Linux app in ${TAG} yet." "Run from source instead: git clone https://github.com/${REPO}.git && cd sam && ./setup.sh"
  fi
  die "No ${PLATFORM}/${ARCH} installer found in ${TAG}." "See github.com/${REPO}/releases/latest"
fi
FILE="$(basename "$ASSET_URL")"
ok "Found ${BOLD}${FILE}${RESET} (${TAG})"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
step "Downloading…"
curl -fsSL --retry 3 -o "$TMP/$FILE" "$ASSET_URL" || die "Download failed (interrupted or blocked)." "Re-run the command — it resumes cleanly."

# ── verify SHA-256 ──
if [ -n "$SUMS_URL" ]; then
  curl -fsSL -o "$TMP/SHA256SUMS.txt" "$SUMS_URL" || true
  if [ -s "$TMP/SHA256SUMS.txt" ]; then
    EXPECT="$(grep -E "  ?${FILE}\$|${FILE} *\$" "$TMP/SHA256SUMS.txt" | grep -oiE '[a-f0-9]{64}' | head -1 || true)"
    if [ -n "$EXPECT" ]; then
      if command -v shasum >/dev/null 2>&1; then GOT="$(shasum -a 256 "$TMP/$FILE" | awk '{print $1}')";
      else GOT="$(sha256sum "$TMP/$FILE" | awk '{print $1}')"; fi
      [ "$GOT" = "$EXPECT" ] || die "⚠ SHA-256 MISMATCH — the download is corrupt or tampered with. NOT installing." "Delete anything downloaded and re-run. If it keeps failing, report it."
      ok "SHA-256 verified"
    fi
  fi
else
  say "  ${DIM}(no checksum file in this release — skipping verify)${RESET}"
fi

# ── install ──
if [ "$PLATFORM" = "mac" ]; then
  step "Installing to /Applications…"
  # NOTE: do NOT pass -quiet — it suppresses the device→mountpoint table we parse for the volume path.
  MNT="$(hdiutil attach "$TMP/$FILE" -nobrowse -noverify | grep -oE '/Volumes/.*' | tail -1 | sed 's/[[:space:]]*$//')"
  [ -d "$MNT" ] || die "Couldn't open the installer disk image." "Try downloading it manually from the releases page."
  APP="$(find "$MNT" -maxdepth 1 -name '*.app' | head -1)"
  rm -rf "/Applications/SAM.app" 2>/dev/null || true
  cp -R "$APP" /Applications/ || { hdiutil detach "$MNT" -quiet || true; die "Couldn't write to /Applications." "Grant permission, or drag SAM.app from the mounted disk manually."; }
  xattr -dr com.apple.quarantine "/Applications/SAM.app" 2>/dev/null || true   # unsigned build → skip Gatekeeper
  hdiutil detach "$MNT" -quiet || true
  ok "Installed SAM.app"
  if [ "${SAM_NO_LAUNCH:-}" != "1" ]; then step "Launching SAM…"; open -a "/Applications/SAM.app" || true; fi
else
  DEST="${HOME}/.local/bin"; mkdir -p "$DEST"
  step "Installing to ${DEST}…"
  install -m 755 "$TMP/$FILE" "$DEST/SAM.AppImage" || die "Couldn't write to ${DEST}." "Check permissions on your home directory."
  ok "Installed to ${DEST}/SAM.AppImage"
  if [ "${SAM_NO_LAUNCH:-}" != "1" ]; then step "Launching SAM…"; ( "$DEST/SAM.AppImage" >/dev/null 2>&1 & ) || say "  ${DIM}Start it any time: ${DEST}/SAM.AppImage${RESET}"; fi
fi

# ── local brain (Ollama) — optional: makes SAM 100% private + offline, no keys ever ──
if command -v ollama >/dev/null 2>&1; then
  ok "Ollama found — pulling a small local brain (llama3.2:3b) in the background…"
  ( ollama pull llama3.2:3b >/dev/null 2>&1 & ) || true
else
  printf "\n${DIM}  Tip: for a 100%% private, offline brain (no keys, ever), install Ollama (~2 min):${RESET}\n"
  printf "  ${BOLD}curl -fsSL https://ollama.com/install.sh | sh${RESET}  ${DIM}then:${RESET}  ${BOLD}ollama pull llama3.2:3b${RESET}\n"
  printf "  ${DIM}SAM already works right now on free cloud brains — this is just an upgrade.${RESET}\n"
fi

cat <<BANNER

${GREEN}${BOLD}  ✓ SAM is installed and starting up.${RESET}

  ${BOLD}Open${RESET} http://localhost:8787 ${DIM}(it opens automatically)${RESET}
  Tell it your name and go — ${BOLD}free out of the box, no key or setup.${RESET}
  ${DIM}Then try:${RESET} "what's the weather and directions to the nearest coffee?"

  ${DIM}Update any time: re-run this same command.${RESET}

BANNER
