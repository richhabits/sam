#!/usr/bin/env bash
# ───────────────────────────────────────────────
#  S.A.M. · one-shot setup
#  clone -> ./setup.sh -> npm run dev
# ───────────────────────────────────────────────
set -e

echo ""
echo "  ┌─────────────────────────────────────┐"
echo "  │   S.A.M. · setup                    │"
echo "  └─────────────────────────────────────┘"
echo ""

# Node check
if ! command -v node >/dev/null 2>&1; then
  echo "  ✗ Node.js not found. Install Node 20+: https://nodejs.org"
  exit 1
fi
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "  ✗ Node $NODE_MAJOR found — SAM needs Node 20+ (Vite requirement)."
  exit 1
fi
echo "  ✓ Node $(node -v)"

# .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  ✓ created .env  — drop your GEMINI_API_KEY or ANTHROPIC_API_KEY in it"
else
  echo "  ✓ .env exists"
fi

# deps
echo "  • installing dependencies…"
npm install --silent
echo "  ✓ dependencies installed"

# optional voice
echo ""
read -p "  Install the 100% local voice engine (faster-whisper + Kokoro)? [y/N] " v
if [ "$v" = "y" ] || [ "$v" = "Y" ]; then
  if command -v python3 >/dev/null 2>&1; then
    python3 -m pip install -q -r voice/requirements.txt && echo "  ✓ voice engine installed (npm run voice)"
  else
    echo "  ✗ python3 not found — skipping voice. Install Python 3.10+ then: pip install -r voice/requirements.txt"
  fi
else
  echo "  • skipped voice — you can type in the HUD, or install later"
fi

echo ""
echo "  ┌─────────────────────────────────────┐"
echo "  │  SAM is ready.                      │"
echo "  │                                     │"
echo "  │  Start it:   npm run dev            │"
echo "  │  HUD:        http://localhost:5273  │"
echo "  │  Voice:      npm run voice (opt)    │"
echo "  └─────────────────────────────────────┘"
echo ""
