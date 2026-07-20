#!/usr/bin/env bash
# Keep the SAM server alive. Installs a per-user launchd agent that runs the built server
# (dist/server.mjs), starts it at login, and auto-restarts it if it ever dies — so SAM is
# never a white screen or a "Failed to fetch" waiting on a manual restart.
#
# Usage:   bash scripts/install-server-daemon.sh          # install + start
#          bash scripts/install-server-daemon.sh --off    # stop + uninstall
set -euo pipefail

LABEL="com.sam.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node || true)"

if [ "${1:-}" = "--off" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "SAM server daemon removed."
  exit 0
fi

[ -n "$NODE" ] || { echo "node not found on PATH — install Node first."; exit 1; }
[ -f "$REPO/dist/server.mjs" ] || { echo "dist/server.mjs missing — run 'npm run build:server' first."; exit 1; }

NODE_BIN_DIR="$(dirname "$NODE")"
mkdir -p "$HOME/Library/LaunchAgents" "$REPO/logs"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE</string>
        <string>$REPO/dist/server.mjs</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$NODE_BIN_DIR:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>$REPO/logs/server-daemon.out</string>
    <key>StandardErrorPath</key>
    <string>$REPO/logs/server-daemon.err</string>
</dict>
</plist>
PLIST

# Reload cleanly so a re-run picks up changes.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"

echo "SAM server daemon installed and started ($LABEL). It will stay up and restart on its own."
