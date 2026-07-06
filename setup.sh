#!/usr/bin/env bash
# ───────────────────────────────────────────────
#  S.A.M. · one-command auto-setup
#  Usage:  clone the repo, cd into it, then:  ./setup.sh
#  Does everything: checks Node, installs, makes .env, offers to start.
# ───────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }

echo ""
bold "  S.A.M. — Smart Artificial Mind · setup"
echo ""

# 1. Node.js — INSTALL IT FOR THEM (no headache). Non-technical friends don't have it.
if ! command -v node >/dev/null 2>&1; then
  warn "Node.js isn't installed — no worries, I'll set it up for you."
  # Make sure Homebrew (Mac's installer) exists; install it quietly if not.
  if ! command -v brew >/dev/null 2>&1; then
    echo "  • installing Homebrew first (it may ask for your Mac password — that's normal)…"
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || true
    # load brew into this session (Apple Silicon or Intel path)
    eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)" || eval "$(/usr/local/bin/brew shellenv 2>/dev/null)" || true
  fi
  if command -v brew >/dev/null 2>&1; then
    echo "  • installing Node…"
    brew install node || true
  fi
  # Still no node? Open the official installer page for them and stop cleanly.
  if ! command -v node >/dev/null 2>&1; then
    warn "Couldn't auto-install Node."
    echo "     → I'll open nodejs.org — click the big green button, install, then run ./setup.sh again."
    command -v open >/dev/null 2>&1 && open "https://nodejs.org/en/download/prebuilt-installer" 2>/dev/null || true
    exit 1
  fi
  ok "Node installed"
fi
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 20 ]; then
  warn "Node $(node -v) is too old — SAM needs Node 20+."
  echo "     → Update at https://nodejs.org — then run ./setup.sh again."
  exit 1
fi
ok "Node $(node -v)"

# 2. dependencies
echo "  • installing dependencies (takes a minute)…"
npm install --silent
# Native modules (better-sqlite3) sometimes need a rebuild — make sure it actually loads.
if ! node -e "require('better-sqlite3')" >/dev/null 2>&1; then
  echo "  • finalising native modules…"
  npm rebuild better-sqlite3 --silent >/dev/null 2>&1 || true
fi
ok "dependencies installed"

# 3. .env
if [ ! -f .env ]; then cp .env.example .env; ok "created .env"; else ok ".env already there"; fi

# 4. brains — SAM WORKS RIGHT NOW with no key (free no-key brain + local Ollama).
ok "SAM works out of the box — no API key needed to start."
echo "     For faster, smarter replies, add a free key any time in Settings → API keys"
echo "     (2 minutes, still free — see FREE-BRAINS.md). Totally optional."

echo ""
bold "  ✅ SAM is ready."
echo "     Start it any time with:  npm start"
echo "     Then open:               http://localhost:8787"
echo ""

# 5. offer to launch now
if [ -t 0 ]; then
  read -r -p "  Start SAM now? [Y/n] " GO
  case "$GO" in
    n|N) echo "  Cool — run 'npm start' whenever you're ready (your browser opens automatically)." ;;
    *)   echo ""; bold "  Starting SAM… your browser will open automatically in a few seconds."
         ( sleep 9; command -v open >/dev/null 2>&1 && open "http://localhost:8787" 2>/dev/null ) &
         npm start ;;
  esac
fi
