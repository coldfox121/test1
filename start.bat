@echo off
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher not found. Please install Python 3 first.
  pause
  exit /b 1
)

echo Starting local server at http://localhost:8000
echo Close the minimized server window to stop it.
start "test1 server" /min py -3 -m http.server 8000
timeout /t 2 >nul
start "" http://localhost:8000
