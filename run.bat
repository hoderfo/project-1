@echo off

start cmd /c "cd backend && python -m uvicorn main:app --reload"

start cmd /c "cd frontend && python -m http.server 4321"

start http://localhost:4321