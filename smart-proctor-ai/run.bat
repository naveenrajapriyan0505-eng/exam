@echo off
TITLE SmartProctor AI - Autonomous Exam Proctoring System
COLOR 0B
echo =====================================================================
echo       SMARTPROCTOR AI - EXAM MANAGEMENT ^& PROCTORING SYSTEM
echo             Final Year Engineering Project (2026)
echo =====================================================================
echo.
echo [1/3] Checking Node.js runtime environment...
set NODE_EXE=d:\tools\node\node.exe
if not exist "%NODE_EXE%" (
    set NODE_EXE=node
)

echo [2/3] Launching SmartProctor AI Server on http://localhost:3000 ...
start "" "%NODE_EXE%" server.js

timeout /t 2 >nul
echo [3/3] Opening SmartProctor AI Portal in your web browser...
start http://localhost:3000

echo.
echo =====================================================================
echo  SERVER RUNNING: http://localhost:3000
echo.
echo  * Student Exam Portal:       http://localhost:3000/student.html
echo  * Admin / Proctor Live Feed: http://localhost:3000/admin.html
echo  * Certified Audit Report:    http://localhost:3000/report.html
echo.
echo  To start the companion Windows Process Monitor in another terminal:
echo    "%NODE_EXE%" process-monitor.js
echo =====================================================================
echo.
pause
