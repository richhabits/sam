#!/bin/bash
# SAM janitor — every 5 minutes (launchd com.sam.janitor), keeps SAM's own footprint tidy.
#
# Deliberately narrow. It only ever touches things SAM itself creates:
#   • orphaned SAM processes (parent died → reparented to launchd, PID 1): a yard worker,
#     esbuild, or a vitest worker started from the SAM checkout. The live server and its
#     own yard worker have a living parent, so they are never matched.
#   • SAM's logs in ~/Library/Logs, rotated when over 20 MB (one old copy kept).
#   • dist-app/ release output older than a day (it's rebuilt by every release).
#   • Xcode DerivedData for SAM's own project (DerivedData/SAM-*) untouched for a day: a
#     regenerable build cache, often gigabytes. Other projects' caches are never touched.
# It never touches the vault, .env, worktrees, user files, or any other project.
# Dry run: SAM_JANITOR_DRY=1 scripts/sam-janitor.sh
set -u
REPO="${SAM_REPO:-$HOME/sam}"
LOG="$HOME/Library/Logs/sam-janitor.log"
DRY="${SAM_JANITOR_DRY:-0}"
say() { printf '%s  %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG"; [ "$DRY" = 1 ] && echo "$*"; }
act() { if [ "$DRY" = 1 ]; then echo "would: $*"; else "$@"; fi; }

# 1. Orphans: PPID 1 and a command line inside the SAM checkout.
ps -Ao pid=,ppid=,etime=,command= | while read -r pid ppid etime cmd; do
  [ "$ppid" = 1 ] || continue
  case "$cmd" in
    *"$REPO/server/yard/worker"*|*"$REPO/dist/yard-worker"*|*"$REPO/node_modules/@esbuild/"*|*"$REPO/node_modules/vitest/"*|*"$REPO/node_modules/.bin/vitest"*)
      say "orphan pid=$pid age=$etime: ${cmd:0:120}"
      act kill "$pid" ;;
  esac
done

# 2. Logs over 20 MB → rotate (keep one previous copy).
for f in "$HOME/Library/Logs"/sam-*.out "$HOME/Library/Logs"/sam-*.err "$HOME/Library/Logs"/sam-*.log; do
  [ -f "$f" ] || continue
  [ "$f" = "$LOG" ] && continue
  size=$(stat -f %z "$f" 2>/dev/null || echo 0)
  if [ "$size" -gt 20971520 ]; then
    say "rotate $f ($((size / 1048576)) MB)"
    act mv -f "$f" "$f.1"; act touch "$f"
  fi
done
# The janitor's own log stays small.
[ -f "$LOG" ] && [ "$(stat -f %z "$LOG")" -gt 1048576 ] && tail -n 500 "$LOG" > "$LOG.tmp" && mv -f "$LOG.tmp" "$LOG"

# 3. Stale release output (rebuilt by every `npm run release:app`).
if [ -d "$REPO/dist-app" ] && [ -n "$(find "$REPO/dist-app" -maxdepth 0 -mtime +1 2>/dev/null)" ]; then
  say "remove stale $REPO/dist-app ($(du -sh "$REPO/dist-app" | cut -f1))"
  act rm -rf "$REPO/dist-app"
fi
# 4. SAM's own Xcode build cache, stale for a day.
for d in "$HOME/Library/Developer/Xcode/DerivedData"/SAM-*; do
  [ -d "$d" ] || continue
  if [ -n "$(find "$d" -maxdepth 0 -mtime +1 2>/dev/null)" ]; then
    say "remove stale Xcode cache $d ($(du -sh "$d" | cut -f1))"
    act rm -rf "$d"
  fi
done
exit 0
