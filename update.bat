@echo off
setlocal enabledelayedexpansion
title Cheat Clip PRO Updater

:: Change directory safely to current folder (handling spaces in path)
cd /d "%~dp0"

echo ===================================================
echo   Updating Cheat Clip PRO to Latest Version
echo ===================================================

:: Setup PATH
if exist "%~dp0venv\Scripts" (
    set "PATH=%~dp0venv\Scripts;%PATH%"
) else if exist "%~dp0.venv\Scripts" (
    set "PATH=%~dp0.venv\Scripts;%PATH%"
)

:: Run Git Pull
where git >nul 2>&1
if %errorlevel% equ 0 (
    echo [1/3] Pulling latest code from Git...
    git pull origin master
) else (
    echo [!] Git not in PATH, skipping git pull...
)

:: Install Node dependencies
echo.
echo [2/3] Checking Node modules...
call npm install
call npm prune

:: Install Python dependencies
echo.
echo [3/3] Checking Python dependencies...
if exist "%~dp0venv\Scripts\python.exe" (
    "%~dp0venv\Scripts\python.exe" -m pip install -r "%~dp0backend\requirements.txt"
) else (
    python -m pip install -r "%~dp0backend\requirements.txt"
)

echo.
echo ===================================================
echo   Update completed successfully!
echo ===================================================
pause
