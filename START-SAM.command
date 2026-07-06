#!/bin/bash
# Double-click to start SAM (macOS). Works from wherever this repo lives.
cd "$(dirname "$0")" || exit 1
# Start local Ollama if installed and not already running (SAM's key-free fallback brain).
command -v ollama >/dev/null 2>&1 && (curl -s http://localhost:11434/api/tags >/dev/null 2>&1 || (ollama serve >/dev/null 2>&1 &))
# Start SAM if it isn't already up, then open the app.
lsof -ti:8787 >/dev/null 2>&1 || (npm start >/tmp/sam.log 2>&1 &)
sleep 6
open http://localhost:8787
