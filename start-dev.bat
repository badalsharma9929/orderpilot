@echo off
title OrderPilot - live editing
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages the first time...
  call npm install || goto :fail
)
echo.
echo  OrderPilot live editing is starting.
echo  1) In Chrome open chrome://extensions, turn on Developer mode,
echo     click "Load unpacked" and pick:  %~dp0.output\chrome-mv3-dev
echo     (only needed once; turn OFF the other OrderPilot copy)
echo  2) Edit any file in src\ and save - Chrome reloads the extension by itself.
echo  3) Keep this window open while editing. Close it to stop.
echo.
call npm run dev
goto :eof
:fail
echo Something went wrong. Is Node.js installed?  https://nodejs.org
pause
