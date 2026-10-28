@echo off
title OrderPilot - build
cd /d "%~dp0"
if not exist node_modules call npm install
call npm run compile && call npm test && call npm run build
if errorlevel 1 (
  echo.
  echo  Build stopped: fix the error shown above, then run this again.
) else (
  echo.
  echo  Done. In chrome://extensions click the reload icon on OrderPilot
  echo  (folder: %~dp0.output\chrome-mv3^)
)
pause
