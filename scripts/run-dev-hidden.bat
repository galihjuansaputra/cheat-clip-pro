@echo off
cd /d "%~dp0.."
call npm run dev < NUL > logs\dev.log 2>&1
