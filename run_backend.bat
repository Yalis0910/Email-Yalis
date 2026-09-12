@echo off
chcp 65001 > nul
echo [Email-Yalis] 正在启动后端服务 (FastAPI / Port 8008)...
cd /d "%~dp0backend"
python run.py
pause
