@echo off
title HOTLAP - local server
cd /d "%~dp0"

echo.
echo   HOTLAP  -  starting local server...
echo.

where python >nul 2>nul
if %errorlevel%==0 (
    start "" http://localhost:8000/
    python -m http.server 8000
    goto :eof
)

where npx >nul 2>nul
if %errorlevel%==0 (
    start "" http://localhost:8000/
    npx --yes serve -l 8000 .
    goto :eof
)

echo   Python or Node is required. Install either one, then run this again.
pause
