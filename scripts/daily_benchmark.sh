#!/bin/bash
# SAM · daily model-colosseum benchmark. Run by launchd once a day.
# Hits the RUNNING SAM's /api/arena so the ranking lands in the vault SAM actually reads
# (and the fight uses SAM's live free-brain pool). If SAM isn't up, it logs a skip and waits
# for tomorrow — a benchmark against a different vault/pool wouldn't steer the real routing.
set -uo pipefail
PORT="${SAM_PORT:-8787}"
# Repo root, derived from this script's own location — portable for anyone who clones SAM,
# and still correct when launchd runs it by absolute path.
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1
mkdir -p logs
STAMP="$(date '+%Y-%m-%d %H:%M:%S %Z')"

# Mac-side guard (the "Mac watches Mac" half; the cloud watchdog reads GitHub).
# Fires a local macOS notification when the nightly fails to land a champion. Best-effort:
# osascript failures must never break the sacred loop, so every call is `|| true`.
notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"SAM nightly\" sound name \"Basso\"" >/dev/null 2>&1 || true
}

# SAM up? (cheap probe) — if not, skip cleanly (but flag it: a skip is a nightly that didn't land).
if ! curl -sf -o /dev/null --max-time 5 "http://localhost:${PORT}/api/status"; then
  echo "${STAMP} · SAM not running on :${PORT} — benchmark skipped" >> logs/daily_benchmark.log
  notify "Skipped — SAM not running on :${PORT}. Nightly did not land."
  exit 0
fi

# A small, diverse prompt set → a more stable ranking than a single question.
BODY='{"prompts":["Explain why the sky is blue in two sentences a 10-year-old would understand.","What is 17 * 23? Show the steps briefly.","Rewrite this to be warmer: your order is late."]}'
OUT="$(curl -s --max-time 360 -X POST -H 'Content-Type: application/json' -d "${BODY}" "http://localhost:${PORT}/api/arena")"

TOP="$(printf '%s' "${OUT}" | python3 -c 'import sys, json
try:
    d = json.load(sys.stdin); lb = d.get("leaderboard", [])
    if lb:
        t = lb[0]; print("champion: %s (%d) - %d matches" % (t["label"], round(t["elo"]), len(d.get("log", []))))
    else:
        print("error: %s" % d.get("error", "?"))
except Exception as e:
    print("unparseable response (%s)" % e)' 2>/dev/null)"

echo "${STAMP} · ${TOP:-no response}" >> logs/daily_benchmark.log

# A landed nightly writes a "champion:" line. Anything else (error, unparseable, no
# response) means the benchmark ran but produced no ranking — alert locally.
case "${TOP:-no response}" in
  champion:*) : ;; # landed cleanly, stay silent
  *) notify "Ran but no champion: ${TOP:-no response}. Ranking not refreshed." ;;
esac
