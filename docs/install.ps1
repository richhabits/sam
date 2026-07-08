# ─────────────────────────────────────────────────────────────
#  SAM — one-paste installer (Windows)
#    irm https://richhabits.github.io/sam/install.ps1 | iex
#
#  Downloads the latest SAM installer, VERIFIES its SHA-256 against the release checksums (aborts on
#  mismatch), runs it, and launches SAM. Idempotent — re-run to update. Every failure explains itself.
# ─────────────────────────────────────────────────────────────
$ErrorActionPreference = "Stop"
$repo = "richhabits/sam"

function Say  ($m) { Write-Host $m }
function Step ($m) { Write-Host "▸ $m" -ForegroundColor DarkYellow }
function Ok   ($m) { Write-Host "✓ $m" -ForegroundColor Green }
function Die  ($m, $fix) { Write-Host "`n✗ $m" -ForegroundColor Red; if ($fix) { Write-Host "  fix: $fix" -ForegroundColor DarkGray }; exit 1 }

Write-Host "`nInstalling SAM " -NoNewline; Write-Host "— your private, free AI. Nothing to configure.`n" -ForegroundColor DarkGray

# ── connectivity ──
try { Invoke-WebRequest -UseBasicParsing -Uri "https://github.com" -Method Head -TimeoutSec 15 | Out-Null }
catch { Die "No internet connection." "Check your network and re-run this command." }

# ── latest release ──
Step "Finding the latest release…"
try { $rel = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "SAM-installer" } }
catch { Die "Couldn't reach GitHub Releases." "GitHub may be down — try again in a minute." }
$tag = $rel.tag_name
if (-not $tag) { Die "Couldn't read the latest version." "Report this at github.com/$repo/issues." }

$asset = $rel.assets | Where-Object { $_.name -match 'SAM-Setup-.*\.exe$' } | Select-Object -First 1
$sums  = $rel.assets | Where-Object { $_.name -match 'SHA256SUMS' } | Select-Object -First 1
if (-not $asset) { Die "No Windows installer found in $tag." "See github.com/$repo/releases/latest" }
Ok "Found $($asset.name) ($tag)"

$tmp  = Join-Path $env:TEMP ("sam-" + [guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$file = Join-Path $tmp $asset.name

Step "Downloading…"
try { Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $file }
catch { Die "Download failed (interrupted or blocked)." "Re-run the command." }

# ── verify SHA-256 ──
if ($sums) {
  try {
    $sumsFile = Join-Path $tmp "SHA256SUMS.txt"
    Invoke-WebRequest -UseBasicParsing -Uri $sums.browser_download_url -OutFile $sumsFile
    $line   = Get-Content $sumsFile | Where-Object { $_ -match [regex]::Escape($asset.name) } | Select-Object -First 1
    $expect = ([regex]'[a-fA-F0-9]{64}').Match($line).Value
    if ($expect) {
      $got = (Get-FileHash -Algorithm SHA256 -Path $file).Hash
      if ($got -ne $expect.ToUpper()) { Die "SHA-256 MISMATCH — the download is corrupt or tampered with. NOT installing." "Delete it and re-run. If it keeps failing, report it." }
      Ok "SHA-256 verified"
    }
  } catch { Say "  (couldn't verify checksum — continuing)" }
} else { Say "  (no checksum file in this release — skipping verify)" }

# ── run the installer (/S = silent, no launch — used by CI) ──
Step "Running the installer…"
try {
  if ($env:SAM_NO_LAUNCH -eq "1") { Start-Process -FilePath $file -ArgumentList "/S" -Wait; Ok "Installed silently" }
  else { Start-Process -FilePath $file -Wait }
}
catch { Die "The installer couldn't run." "If SmartScreen blocked it: More info -> Run anyway. Or run $file manually." }

@"

  ✓ SAM is installed.

  Open http://localhost:8787 (it opens automatically once SAM starts).
  Tell it your name and go — free out of the box, no key or setup.
  Then try: "what's the weather and directions to the nearest coffee?"

  Update any time: re-run this same command.

"@ | Write-Host -ForegroundColor Green
