#!/usr/bin/env bash
# Keep the SAM server alive. Installs a per-user launchd agent that runs the built server
# (dist/server.mjs), starts it at login, and auto-restarts it if it ever dies — so SAM is
# never a white screen or a "Failed to fetch" waiting on a manual restart.
#
# launchd never touches the repo directly. It runs a supervisor copied onto the INTERNAL disk,
# and writes its logs there too, because everything in a plist is a hard dependency at spawn
# time: a ProgramArguments path, a WorkingDirectory or a StandardErrorPath on an unmounted
# external drive makes the job fail to launch at all, which KeepAlive then retries forever.
# The supervisor decides when to actually start the server — see scripts/sam-server-supervisor.sh
# for why that decision cannot live in the plist.
#
# Usage:   bash scripts/install-server-daemon.sh          # install + start
#          bash scripts/install-server-daemon.sh --off    # stop + uninstall
set -euo pipefail

LABEL="com.sam.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SUPPORT="$HOME/Library/Application Support/SAM"
SUPERVISOR="$SUPPORT/sam-server-supervisor.sh"
LOGDIR="$HOME/Library/Logs"
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
mkdir -p "$HOME/Library/LaunchAgents" "$SUPPORT" "$LOGDIR"
install -m 755 "$REPO/scripts/sam-server-supervisor.sh" "$SUPERVISOR"

# No SAM_CONTROL_TOKEN here on purpose. A fixed passkey in a mode-644 plist is readable by every
# other process on this Mac — the exact caller the Handshake exists to refuse. Unset, the server
# mints a random one per launch and browsers/phones pair instead.
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SUPERVISOR</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$NODE_BIN_DIR:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>SAM_REPO</key>
        <string>$REPO</string>
        <key>SAM_NODE</key>
        <string>$NODE</string>
        <key>SAM_YARD</key>
        <string>1</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>$LOGDIR/sam-server.out</string>
    <key>StandardErrorPath</key>
    <string>$LOGDIR/sam-server.err</string>
</dict>
</plist>
PLIST

# Reload cleanly so a re-run picks up changes.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"

echo "SAM server daemon installed and started ($LABEL)."
echo "  supervisor : $SUPERVISOR"
echo "  logs       : $LOGDIR/sam-server.out (and .err)"
echo "It yields to SAM.app when that's running, and takes the port back when the app quits."
