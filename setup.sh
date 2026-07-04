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

# 1. Node.js
if ! command -v node >/dev/null 2>&1; then
  warn "Node.js isn't installed."
  echo "     → Get it (one click) at https://nodejs.org  — then run ./setup.sh again."
  exit 1
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
ok "dependencies installed"

# 3. .env
if [ ! -f .env ]; then cp .env.example .env; ok "created .env"; else ok ".env already there"; fi

# 4. free key check
if ! grep -qE '^[A-Z]+_API_KEYS?=.+' .env 2>/dev/null; then
  echo ""
  bold "  One thing left — give SAM a free brain (60 seconds):"
  echo "     1. Open https://console.groq.com/keys  → sign in → Create API Key → copy it"
  echo "     2. Either paste it into .env  (GROQ_API_KEYS=your_key)"
  echo "        …or just start SAM and paste it in Settings → API keys."
fi

echo ""
bold "  ✅ SAM is set up."
echo "     Start it any time with:  npm start"
echo "     Then open:               http://localhost:8787"
echo ""

# 5. offer to launch now
if [ -t 0 ]; then
  read -r -p "  Start SAM now? [Y/n] " GO
  case "$GO" in
    n|N) echo "  Cool — run 'npm start' whenever you're ready." ;;
    *)   echo ""; bold "  Starting SAM… (open http://localhost:8787)"; npm start ;;
  esac
fi
