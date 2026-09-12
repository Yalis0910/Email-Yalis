@echo off
chcp 65001 > nul
echo ========================================================
echo        Email-Yalis 邮件资产可视化管理系统
echo ========================================================
echo [1/3] 正在启动后端 API 引擎 (http://0.0.0.0:8008 - 局域网全网卡监听)...
start "Email-Yalis Backend" "%~dp0run_backend.bat"

echo [2/3] 正在启动前端可视化大屏 (http://localhost:5173)...
start "Email-Yalis Frontend" "%~dp0run_frontend.bat"

echo [3/3] 正在为您打开控制台页面...
timeout /t 3 > nul
start http://localhost:5173

echo.
echo 系统已启动！关闭本窗口不会终止前后端服务。
echo 如需停止服务，请关闭弹出的两个命令行窗口。
echo ========================================================
