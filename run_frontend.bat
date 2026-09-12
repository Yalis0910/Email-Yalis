@echo off
chcp 65001 > nul
echo [Email-Yalis] 正在启动前端服务 (Vite / Port 5173)...
cd /d "%~dp0frontend"
npm run dev
pause
