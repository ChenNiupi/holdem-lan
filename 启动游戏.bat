@echo off
chcp 65001 >nul
title 好友德州
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 20 LTS：https://nodejs.org/
  pause
  exit /b 1
)

if not exist node_modules (
  echo 首次运行，正在安装依赖，请稍候...
  call npm install
  if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo 正在构建并启动牌桌，稍后会自动打开浏览器...
start "" cmd /c "timeout /t 5 >nul & start http://localhost:3000"
call npm run play
pause
