@echo off
REM Starts QQNotice in production mode. Backend serves both API and web.
REM Run `pnpm setup` once before the first start.
cd /d "%~dp0"
pnpm start
