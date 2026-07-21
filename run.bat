@echo off
call :compose_up
if %ERRORLEVEL% NEQ 0 exit /B %ERRORLEVEL%

if not exist .\venv\Scripts\python.exe (
    echo Python environment not found. Run setup.bat first.
    exit /B 1
)

start /B "" .\venv\Scripts\python.exe -u worker\worker.py
start http://localhost:8000/
.\venv\Scripts\python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
exit /B %ERRORLEVEL%

:compose_up
docker compose version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    docker compose up -d
) else (
    docker-compose up -d
)
exit /B %ERRORLEVEL%