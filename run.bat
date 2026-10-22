@echo off
setlocal
title Pip Manager
echo ===================================================
echo   Pip Manager - Local Environment Inspector
echo ===================================================
echo.

where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python is not installed or not in PATH!
    pause
    exit /b 1
)

python server.py %*
pause
