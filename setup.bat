@echo off
if not exist venv python -m venv venv
call venv\Scripts\activate.bat

python -m pip install --upgrade pip
if %ERRORLEVEL% NEQ 0 exit /B %ERRORLEVEL%

pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 exit /B %ERRORLEVEL%

call :compose_up
if %ERRORLEVEL% NEQ 0 exit /B %ERRORLEVEL%

docker build -t c_ide_env docker
pause
exit /B %ERRORLEVEL%

:compose_up
docker compose version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    docker compose up -d
) else (
    docker-compose up -d
)
exit /B %ERRORLEVEL%