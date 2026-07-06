# ───────────────────────────────────────────────
#  S.A.M. · one-command auto-setup (Windows)
#  Usage:  clone the repo, cd into it, then:
#    powershell -ExecutionPolicy Bypass -File .\setup.ps1
#  Does everything: checks Node, installs, makes .env, offers to start.
#  (macOS/Linux: use ./setup.sh)
# ───────────────────────────────────────────────
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function OK($m)   { Write-Host "  " -NoNewline; Write-Host "✓ $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  " -NoNewline; Write-Host "! $m" -ForegroundColor Yellow }

Write-Host ""
Write-Host "S.A.M. — Smart Artificial Mind · setup" -ForegroundColor White
Write-Host ""

# 1. Node
try {
  $nodeV = (node -v) -replace "v", ""
  $major = [int]($nodeV.Split(".")[0]); $minor = [int]($nodeV.Split(".")[1])
  if (($major -eq 20 -and $minor -ge 19) -or ($major -ge 22 -and -not ($major -eq 21))) { OK "Node $nodeV" }
  else { Warn "Node $nodeV found — SAM needs 20.19+ or 22.12+. Get it: https://nodejs.org"; exit 1 }
} catch {
  Warn "Node.js not found. Install the LTS from https://nodejs.org then re-run this."
  exit 1
}

# 2. Install
Write-Host ""
Write-Host "Installing dependencies (grab a coffee)..."
npm install
OK "dependencies installed"

# 3. .env
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  OK ".env created (add a free AI key in the app under Settings, or edit .env)"
} else { OK ".env already exists — keeping yours" }

# 4. Offer to start
Write-Host ""
$go = Read-Host "Start SAM now? (Y/n)"
if ($go -eq "" -or $go -match "^[Yy]") {
  Write-Host "Starting... open http://localhost:8787 when it says 'SAM online'."
  npm start
} else {
  Write-Host ""
  Write-Host "When ready:  npm start   then open http://localhost:8787"
  Write-Host "Free AI keys (15 min, then free forever): see FREE-BRAINS.md"
}
