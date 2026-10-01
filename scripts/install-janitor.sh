#!/bin/bash
# Installs the SAM janitor as a per-user launchd job that runs every 5 minutes.
# Uninstall: launchctl bootout gui/$(id -u)/com.sam.janitor && rm ~/Library/LaunchAgents/com.sam.janitor.plist
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SUPPORT="$HOME/Library/Application Support/SAM"
PLIST="$HOME/Library/LaunchAgents/com.sam.janitor.plist"
mkdir -p "$SUPPORT" "$HOME/Library/LaunchAgents"
install -m 755 "$REPO/scripts/sam-janitor.sh" "$SUPPORT/sam-janitor.sh"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.sam.janitor</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$SUPPORT/sam-janitor.sh</string></array>
  <key>EnvironmentVariables</key><dict><key>SAM_REPO</key><string>$REPO</string></dict>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PL
launchctl bootout "gui/$(id -u)/com.sam.janitor" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "SAM janitor installed: every 5 minutes, log at ~/Library/Logs/sam-janitor.log"
