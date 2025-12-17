@echo off
setlocal EnableDelayedExpansion

REM Start Python HTTP server in background and capture PID
start "" /b python -m http.server 8000

REM Find the PID of the python http.server bound to port 8000
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do (
    set SERVER_PID=%%p
)

REM Give server a moment
timeout /t 1 >nul

REM Open browser
start "" http://localhost:8000/index.html

echo.
echo ===============================
echo Server running (PID=%SERVER_PID%)
echo Press any key to stop and exit
echo ===============================
pause >nul

REM Kill ONLY this server process
if defined SERVER_PID (
    taskkill /pid %SERVER_PID% /f >nul 2>&1
)

echo Server stopped.
endlocal
