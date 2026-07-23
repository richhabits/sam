#!/usr/bin/env bash
# Builds SAM.app on the Desktop — a one-click launcher (no Terminal window).
# Double-click SAM.app: starts Ollama (if present) + SAM, opens it in the browser.
set -e
# Repo root = one level up from this script, wherever it's checked out.
REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Desktop/SAM.app"
SVG="$REPO/public/icon.svg"
# AUDIT FIX: build in a private mktemp dir instead of predictable /tmp paths — a pre-planted
# file or symlink at /tmp/sam-app.applescript could otherwise be edited-in-place and compiled.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/sam-build.XXXXXX")"; trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/sam-app.applescript" <<'AS'
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
sed -i '' "s#__SAMDIR__#$REPO#g" "$WORK/sam-app.applescript"

rm -rf "$APP"
osacompile -o "$APP" "$WORK/sam-app.applescript"
echo "✓ built $APP"

# apply the SAM icon (best-effort)
if qlmanage -t -s 1024 -o "$WORK" "$SVG" >/dev/null 2>&1 && [ -f "$WORK/icon.svg.png" ]; then
  rm -rf "$WORK/SAM.iconset"; mkdir -p "$WORK/SAM.iconset"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$WORK/icon.svg.png" --out "$WORK/SAM.iconset/icon_${s}x${s}.png" >/dev/null 2>&1
    sips -z $((s*2)) $((s*2)) "$WORK/icon.svg.png" --out "$WORK/SAM.iconset/icon_${s}x${s}@2x.png" >/dev/null 2>&1
  done
  iconutil -c icns "$WORK/SAM.iconset" -o "$WORK/SAM.icns" >/dev/null 2>&1 \
    && cp "$WORK/SAM.icns" "$APP/Contents/Resources/applet.icns" && touch "$APP" && echo "✓ icon applied"
fi
echo "Done. Double-click SAM.app on your Desktop."
