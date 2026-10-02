#!/bin/zsh
# App Store screenshots from DEMO MODE only: fictional fixtures (SAMKit DemoBrain), never a real vault.
# Usage: scripts/screenshots.sh <simulator-udid> [out-dir]   (Debug build of the SAM scheme first)
set -euo pipefail
U=${1:?simulator UDID}
OUT=${2:-$(dirname $0)/../Screenshots/raw/$(xcrun simctl list devices | grep -m1 "$U" | sed -E 's/^ *([^(]+) \(.*/\1/' | tr ' ' '-')}
APP=$(print -l ~/Library/Developer/Xcode/DerivedData/SAM-*/Build/Products/Debug-iphonesimulator/SAM.app(N) | head -1)
APP=${SAM_APP:-$APP}
[[ -d $APP ]] || { echo "build the SAM scheme for the simulator first (or set SAM_APP)"; exit 1; }
mkdir -p "$OUT"
xcrun simctl boot "$U" 2>/dev/null || true
xcrun simctl bootstatus "$U" -b >/dev/null
xcrun simctl status_bar "$U" override --time 09:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
xcrun simctl uninstall "$U" com.hectic.sam.mobile 2>/dev/null || true     # fresh: no pairing, no real data
xcrun simctl install "$U" "$APP"
for tab in chat vault yard crew addOns; do
  for wait in 8 15; do      # retry once if the screen is still blank
    xcrun simctl launch --terminate-running-process "$U" com.hectic.sam.mobile -samDemo 1 -samTab $tab >/dev/null
    sleep $wait
    xcrun simctl io "$U" screenshot "$OUT/$tab.png" >/dev/null
    sd=$(python3 -c "from PIL import Image,ImageStat as S;i=Image.open('$OUT/$tab.png').convert('L');w,h=i.size;print(round(S.Stat(i.crop((0,int(h*.15),w,int(h*.85)))).stddev[0]))")
    (( sd > 22 )) && break
  done
  echo "$tab → $OUT/$tab.png"
done
xcrun simctl status_bar "$U" clear
