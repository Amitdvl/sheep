@echo off
setlocal
if "%~1"=="install" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Amitdvl/sheep/main/scripts/install.ps1 | iex"
  exit /b %errorlevel%
)
wsl.exe -d Ubuntu -- bash -lc "~/.local/bin/sheep %*"
