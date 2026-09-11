@echo off
REM Double-click to start SAM (Windows). No bash, no curl — PowerShell is on every supported box.
cd /d "%~dp0"

if exist "%ProgramFiles%\SAM\SAM.exe" (
  start "" "%ProgramFiles%\SAM\SAM.exe"
  exit /b 0
)
if exist "%LocalAppData%\Programs\SAM\SAM.exe" (
  start "" "%LocalAppData%\Programs\SAM\SAM.exe"
  exit /b 0
)

REM Start local Ollama if installed and not already running (key-free fallback brain).
where ollama >nul 2>nul && (
  powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri http://127.0.0.1:11434/api/tags -TimeoutSec 2 | Out-Null } catch { exit 1 }"
  if errorlevel 1 start /b "" ollama serve
)

REM From source: browser HUD. Packaged SAM.exe above is the real Windows app.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri http://127.0.0.1:8787/api/status -TimeoutSec 2 | Out-Null } catch { exit 1 }"
if errorlevel 1 start /b "" cmd /c "npm start"
timeout /t 6 /nobreak >nul
start http://localhost:8787
