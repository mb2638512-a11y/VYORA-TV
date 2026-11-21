@echo off
REM Vyora TV - one click start
setlocal
cd /d "%~dp0"

echo [1/3] Checking dataset...
if not exist "server\data\index.json" (
  echo      dataset missing - building...
  node scripts\build-data.mjs
)

echo [2/3] Building web app...
pushd web
call npx vite build > nul 2>&1
popd

echo [3/3] Starting server on http://127.0.0.1:8787 ...
start "" cmd /c "node server\src\index.js"
timeout /t 3 /nobreak > nul
start "" http://127.0.0.1:8787
echo Done. Server running at http://127.0.0.1:8787
endlocal
