@echo off
cd /d "%~dp0"
echo Starting Pocketeers static server on http://localhost:8080 ...
npx --yes http-server -p 8080 -c-1
