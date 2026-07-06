#!/bin/bash
# Double-click to start SAM (from the fast internal copy at ~/sam).
cd "$HOME/sam" || exit 1
command -v ollama >/dev/null 2>&1 && (curl -s http://localhost:11434/api/tags >/dev/null 2>&1 || (ollama serve >/dev/null 2>&1 &))
lsof -ti:8787 >/dev/null 2>&1 || (npm start >/tmp/sam.log 2>&1 &)
sleep 6
open http://localhost:8787
