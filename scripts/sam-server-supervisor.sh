#!/usr/bin/env bash
# THE KEEPALIVE'S SUPERVISOR — one long-lived process that decides when SAM's server should be up.
#
# Why this exists instead of pointing launchd straight at dist/server.mjs, which is what the first
# version did: launchd's KeepAlive restarts anything that exits, and it cannot tell "the server
# crashed, bring it back" apart from "the server had no business starting right now". Both of the
# normal reasons NOT to start look like a crash to launchd:
#
#   1. The repo lives on an external USB drive. Unmounted, node exits instantly with MODULE_NOT_FOUND
#      and launchd retries every ThrottleInterval, forever. That is not hypothetical — the previous
#      plist pointed at a dist/ that had been deleted and logged 60,104 failed starts into a 28 MB
#      error file before anyone noticed. A dead keepalive is quiet; a crash-looping one is quiet too.
#   2. The desktop app EMBEDS this same server (electron/main.ts imports server/index.ts) and mints
#      its own per-launch Handshake passkey in preboot. Two servers cannot share port 8787, and they
#      cannot share the passkey either — preboot's secret reaches the renderer through Electron's
#      contextBridge, which a separate daemon has no way to hand over. Whoever binds the port first
#      wins and the other's clients get refused. So this yields: if SAM.app is running, it IS the
#      server, and the daemon stays out of the way until the app quits.
#
# The result is a daemon that fills the gap rather than fighting for it — the Chrome-App shortcut
# and the phone keep working when the desktop app is closed, which is the whole reason it exists.
#
# Deliberately NOT given a fixed SAM_CONTROL_TOKEN. The old plist hardcoded one, world-readable at
# mode 644, which hands the Handshake's secret to exactly the threat it was written to stop: any
# other local process. Left unset, server/handshake.ts mints a fresh random one per launch that
# nothing can read, and non-Electron clients authenticate the way they were designed to — by
# pairing (server/pairing.ts), which the server prints a link for on boot when no device is paired.
set -uo pipefail

REPO="${SAM_REPO:?SAM_REPO must point at the SAM checkout}"
PORT="${PORT:-8787}"
NODE="${SAM_NODE:-node}"
APP_MATCH="${SAM_APP_MATCH:-SAM.app/Contents/MacOS/SAM}"
GRACE_SEC="${SAM_GRACE_SEC:-20}"
ENTRY="$REPO/dist/server.mjs"
grace_used=0

log() { printf '%s  %s\n' "$(date -u +%FT%TZ)" "$*"; }

# Say each reason for waiting ONCE, not every loop — otherwise a drive left unplugged overnight
# rebuilds the same 28 MB log this script was written to prevent.
last_reason=""
wait_because() {
  [ "$1" = "$last_reason" ] || { log "$1"; last_reason="$1"; }
  sleep "$2"
}

shutdown() { [ -n "${CHILD:-}" ] && kill "$CHILD" 2>/dev/null; exit 0; }
trap shutdown TERM INT

log "supervisor up · repo=$REPO port=$PORT"

while true; do
  # The repo is on a removable volume AND holds the vault the server reads, so an unmounted drive
  # means there is nothing useful to serve — wait for it rather than failing loudly forever.
  if [ ! -f "$ENTRY" ]; then
    wait_because "waiting for $ENTRY (drive unmounted, or dist not built yet)" 30
    continue
  fi
  # The ONLY reason to stand down is that someone is already serving — the desktop app, a dev
  # `npx tsx server/index.ts`, a stale copy. Deliberately keyed on the listening socket rather
  # than on SAM.app being alive: the app binds port 8787 once, at launch, and never retries, so
  # an app that lost that race is running and NOT serving. Standing down for it would leave
  # nothing serving at all, which is the exact white-screen failure this daemon exists to end.
  if lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    wait_because "port $PORT already served by another process — standing down" 15
    continue
  fi
  # One exception, for the login race: if the app is up but hasn't bound yet, give it a moment
  # rather than stealing the port it is about to want. It serves its own renderer with a passkey
  # this daemon cannot know, so when the app can serve, it should.
  if pgrep -f "$APP_MATCH" >/dev/null 2>&1 && [ "$grace_used" != "1" ]; then
    grace_used=1
    wait_because "SAM.app is starting — giving it $GRACE_SEC s to take port $PORT first" "$GRACE_SEC"
    continue
  fi

  last_reason=""
  log "starting server from $ENTRY"
  cd "$REPO" || { wait_because "cannot cd into $REPO" 30; continue; }
  "$NODE" "$ENTRY" &
  CHILD=$!

  # Then just hold it until the server exits. Note what is NOT here: stepping aside when SAM.app
  # launches later. Handing the port over sounds polite but helps nobody — the app already failed
  # its one bind attempt, so freeing the port only takes the browser and the phone down too. The
  # app is degraded for that session either way; SAM staying up is the better half of the trade.
  wait "$CHILD" 2>/dev/null
  code=$?
  CHILD=""
  log "server exited (status $code)"
  sleep 2
done
