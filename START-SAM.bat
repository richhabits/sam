@echo off
REM Double-click to start SAM (Windows). Works from wherever this repo lives.
cd /d "%~dp0"

REM Start local Ollama if installed and not already running (key-free fallback brain).
where ollama >nul 2>nul && (
  curl -s http://localhost:11434/api/tags >nul 2>nul || start /b "" ollama serve
)

REM Start SAM if it isn't already up, then open the app.
curl -s http://127.0.0.1:8787/api/status >nul 2>nul || start /b "" cmd /c "npm start"
timeout /t 6 /nobreak >nul
start http://localhost:8787
