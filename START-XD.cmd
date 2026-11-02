@echo off
setlocal
cd /d "%~dp0apps\web"
if errorlevel 1 goto missing
where node >nul 2>&1
if errorlevel 1 goto node_missing
node -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"
if errorlevel 1 goto node_missing
where npm.cmd >nul 2>&1
if errorlevel 1 goto node_missing
if not exist package-lock.json goto missing
if not exist node_modules\next\package.json (
  echo Installing project dependencies...
  call npm.cmd ci
  if errorlevel 1 goto failed
)
if not exist .env.local (
  copy /y .env.example .env.local >nul
  if errorlevel 1 goto failed
)
echo.
echo XD local server: http://localhost:3000
echo Open this address after the server says Ready.
echo Keep this window open. Press Ctrl+C to stop.
echo Supabase configuration is required for login and guild data.
call npm.cmd run dev -- --port 3000
if errorlevel 1 goto failed
exit /b 0
:node_missing
echo Install Node.js 24 LTS from https://nodejs.org/ and run this file again.
pause
exit /b 1
:missing
echo Extract the complete project ZIP before running START-XD.cmd.
pause
exit /b 1
:failed
echo Startup failed. Keep the error above for troubleshooting.
pause
exit /b 1
