@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo 처음 실행: 필요한 파일 설치 중...
  call npm install
)
start "" http://localhost:4321
node server.js
pause
