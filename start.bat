@echo off
chcp 65001 > nul
title 소설 아카이브 스튜디오 - 로컬 서버

echo =======================================================
echo 📖 소설 아카이브 스튜디오 (소설.메인.한국) 실행 중...
echo =======================================================

cd /d "%~dp0"
"C:\Users\asd\.gemini\antigravity\scratch\node-portable\node-v20.18.1-win-x64\node.exe" server.js

pause
