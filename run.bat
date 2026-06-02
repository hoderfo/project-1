@echo off

start cmd /k "cd backend && uvicorn main:app --reload"

timeout /t 2 > nul

start cmd /k "cd frontend && python -m http.server 3000"

timeout /t 2 > nul

start http://localhost:3000