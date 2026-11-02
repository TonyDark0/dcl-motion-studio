@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Instala primero las dependencias con npm ci.
  pause
  exit /b 1
)
echo DCL Motion Studio: http://127.0.0.1:5173
call npm run dev
pause
