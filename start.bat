@echo off
setlocal enabledelayedexpansion
title Cheat Clip PRO

:: Change directory safely to current folder (handling spaces in path)
cd /d "%~dp0"

echo ===================================================
echo   Starting Cheat Clip PRO
echo ===================================================

:: Ensure standard Node.js installation paths are in PATH if missing
where npm >nul 2>&1
if %errorlevel% neq 0 (
    if exist "%ProgramFiles%\nodejs" (
        set "PATH=%ProgramFiles%\nodejs;!PATH!"
    ) else if exist "%ProgramFiles(x86)%\nodejs" (
        set "PATH=%ProgramFiles(x86)%\nodejs;!PATH!"
    ) else if exist "%LOCALAPPDATA%\Programs\nodejs" (
        set "PATH=%LOCALAPPDATA%\Programs\nodejs;!PATH!"
    )
)

:: If local venv exists, prepend its Scripts directory to PATH
if exist "%~dp0venv\Scripts" (
    set "PATH=%~dp0venv\Scripts;!PATH!"
) else if exist "%~dp0.venv\Scripts" (
    set "PATH=%~dp0.venv\Scripts;!PATH!"
)

:: Verify Node.js and NPM
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] npm is not found in your system PATH!
    echo Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)

:: Check if node_modules exists, install if missing
if not exist "%~dp0node_modules" (
    echo [INFO] node_modules not found. Installing dependencies...
    call npm install
)

:: Run the application via native runner
if exist "%~dp0scripts\dev.js" (
    node "%~dp0scripts\dev.js"
) else (
    call npm run dev
)
if %errorlevel% neq 0 (
    echo.
    echo [WARNING] Application stopped with error code %errorlevel%.
    echo If you encounter module errors, run update.bat to refresh dependencies.
    pause
)
