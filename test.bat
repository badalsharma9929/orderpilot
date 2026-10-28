@echo off
title OrderPilot - tests
cd /d "%~dp0"
if not exist node_modules call npm install
echo Type check...
call npm run compile || goto :fail
echo Unit tests...
call npm test || goto :fail
echo End-to-end (Amazon + JioMart, simulated sites)...
call npm run e2e || goto :fail
echo.
echo  All checks passed.
pause
goto :eof
:fail
echo.
echo  A check failed - see the messages above.
pause
