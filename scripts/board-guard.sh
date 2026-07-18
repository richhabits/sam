#!/bin/bash
# Reject a docs/BOARD.md commit that DELETES most of the board.
#
# Written after the board was clobbered three times in one day. Each time a session staged a
# stale copy of BOARD.md and wrote it back wholesale, silently deleting corrections that were
# already committed — a disproved-collision note, a Gate 1 rejection, a cage review, a wiring
# result. The prose rule ("diff against the live tree, add only your own lines") was stated on
# the board itself and did not survive contact. So the machine enforces it now.
#
# The board only ever GROWS in normal use: sessions append findings and prune stale lines by a
# few at a time. A change removing a large fraction of it is a clobber until proven otherwise.
#
# Deliberate rewrites are still possible — BOARD_REWRITE=1 git commit ... — which makes
# destroying the record a thing you have to *mean*, rather than a thing you can do by accident.
set -uo pipefail
THRESHOLD=25   # percent of lines removed

git diff --cached --quiet -- docs/BOARD.md && exit 0        # board not staged, nothing to check
[ "${BOARD_REWRITE:-0}" = "1" ] && { echo "board-guard: BOARD_REWRITE=1 — deletion allowed."; exit 0; }
git cat-file -e HEAD:docs/BOARD.md 2>/dev/null || exit 0    # no prior version (first commit)

STATS="$(git diff --cached --numstat -- docs/BOARD.md | head -1)"
ADDED="$(echo "$STATS" | cut -f1)"; REMOVED="$(echo "$STATS" | cut -f2)"
TOTAL="$(git show HEAD:docs/BOARD.md | grep -c '')"
[ "$TOTAL" -eq 0 ] && exit 0
PCT=$(( REMOVED * 100 / TOTAL ))

if [ "$PCT" -ge "$THRESHOLD" ]; then
  cat >&2 <<MSG

  ✗ board-guard: this commit deletes ${REMOVED}/${TOTAL} lines (${PCT}%) of docs/BOARD.md.

  The board has been clobbered three times by exactly this: a session staged a stale copy and
  wrote it back, deleting corrections that were already committed. Almost always the fix is:

      git checkout HEAD -- docs/BOARD.md    # take the COMMITTED version
      # then re-apply ONLY your new lines onto it

  Note the 'HEAD --'. Plain 'git checkout docs/BOARD.md' restores from the INDEX, and if you
  already staged the clobbered file that restores the clobber. (This message used to say
  exactly that, and it wasted a restore.)

  If you genuinely mean to rewrite the board:  BOARD_REWRITE=1 git commit ...
  (+${ADDED} added / -${REMOVED} removed)

MSG
  exit 1
fi
exit 0
