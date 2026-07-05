#!/usr/bin/env bash
# Builds SAM.app on the Desktop — a one-click launcher (no Terminal window).
# Double-click SAM.app: starts Ollama (if present) + SAM, opens it in the browser.
set -e
# Repo root = one level up from this script, wherever it's checked out.
REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Desktop/SAM.app"
SVG="$REPO/public/icon.svg"

cat > /tmp/sam-app.applescript <<'AS'
on run
	set samDir to "__SAMDIR__"
	set nodeBin to ""
	try
		set nodeBin to do shell script "ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | tail -1"
	end try
	set pathPrefix to nodeBin & ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
	try
		do shell script "export PATH=" & quoted form of pathPrefix & "; cd " & quoted form of samDir & " && (command -v ollama >/dev/null 2>&1 && (curl -s http://localhost:11434/api/tags >/dev/null 2>&1 || (ollama serve >/dev/null 2>&1 &)) ); ([ -d node_modules ] || npm install >/tmp/sam-install.log 2>&1); (lsof -ti:8787 >/dev/null 2>&1 || (nohup npm start >/tmp/sam-run.log 2>&1 &))"
	end try
	delay 6
	do shell script "open http://localhost:8787"
	display notification "SAM is running — enjoy." with title "S.A.M."
end run
AS

# Substitute the real repo path into the compiled AppleScript (heredoc is quoted
# so it stays literal above — no accidental $HOME expansion in the AppleScript body).
sed -i '' "s#__SAMDIR__#$REPO#g" /tmp/sam-app.applescript

rm -rf "$APP"
osacompile -o "$APP" /tmp/sam-app.applescript
echo "✓ built $APP"

# apply the SAM icon (best-effort)
if qlmanage -t -s 1024 -o /tmp "$SVG" >/dev/null 2>&1 && [ -f /tmp/icon.svg.png ]; then
  rm -rf /tmp/SAM.iconset; mkdir -p /tmp/SAM.iconset
  for s in 16 32 128 256 512; do
    sips -z $s $s /tmp/icon.svg.png --out /tmp/SAM.iconset/icon_${s}x${s}.png >/dev/null 2>&1
    sips -z $((s*2)) $((s*2)) /tmp/icon.svg.png --out /tmp/SAM.iconset/icon_${s}x${s}@2x.png >/dev/null 2>&1
  done
  iconutil -c icns /tmp/SAM.iconset -o /tmp/SAM.icns >/dev/null 2>&1 \
    && cp /tmp/SAM.icns "$APP/Contents/Resources/applet.icns" && touch "$APP" && echo "✓ icon applied"
fi
echo "Done. Double-click SAM.app on your Desktop."
