# Online C IDE

A local web IDE for writing, saving, running, and debugging C code in Docker.

## Project Structure

- `backend/` FastAPI app, authentication, project storage, WebSocket execution bridge.
- `worker/` Background process that compiles/runs submitted C code in Docker.
- `frontend/` Monaco editor, xterm terminal, auth modal, project saving UI, debugger UI.
- `docker/` Docker image used for compiling/running C programs with `gcc` and `gdb`.
- `docker-compose.yml` Local Postgres and Redis services.
- `setup.bat` Creates the Python environment, installs dependencies, starts services, builds the C runtime image.
- `run.bat` Starts Postgres/Redis, worker, browser, and FastAPI server.

## Run Locally

1. Install Docker Desktop and Python.
2. Run `setup.bat` once.
3. Run `run.bat`.
4. Open `http://localhost:8000`.

Runtime folders such as `venv/`, `temp/`, and `__pycache__/` are generated automatically and are intentionally ignored.