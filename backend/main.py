import asyncio
import json
import os
import secrets

import redis.asyncio as aioredis
from fastapi import Depends, FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.future import select

from .auth import create_session, delete_session, get_password_hash, get_user_by_session, verify_password
from .database import get_db, init_db
from .models import Project, User

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6380")
EXEC_QUEUE = os.getenv("EXEC_QUEUE", "c_ide_jobs")

app = FastAPI()
redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)


class UserCreate(BaseModel):
    username: str
    password: str


class ProjectData(BaseModel):
    name: str
    code: str


@app.on_event("startup")
async def startup_event():
    await init_db()


def validate_password_length(password: str):
    if len(password) > 72:
        raise HTTPException(status_code=400, detail="Password cannot be longer than 72 characters")


async def get_user_id_from_request(request: Request):
    token = request.cookies.get("session_token")
    if not token:
        return None

    user = await get_user_by_session(token)
    return user.id if user else None


@app.post("/api/register")
async def register(user: UserCreate, db=Depends(get_db)):
    validate_password_length(user.password)

    result = await db.execute(select(User).where(User.username == user.username))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="Username already registered")

    db.add(User(username=user.username, hashed_password=get_password_hash(user.password)))
    await db.commit()
    return {"message": "User registered successfully"}


@app.post("/api/login")
async def login(user: UserCreate, response: Response, db=Depends(get_db)):
    validate_password_length(user.password) 

    result = await db.execute(select(User).where(User.username == user.username))
    db_user = result.scalars().first()
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect username or password")

    token = await create_session(db_user.id)
    response.set_cookie(key="session_token", value=token, httponly=True, samesite="lax")
    return {"message": "Logged in successfully", "username": db_user.username}


@app.post("/api/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await delete_session(token)
        response.delete_cookie("session_token")
    return {"message": "Logged out successfully"}


@app.get("/api/me")
async def me(request: Request):
    token = request.cookies.get("session_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user = await get_user_by_session(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid session")

    return {"username": user.username}


@app.post("/api/projects")
async def save_project(project: ProjectData, request: Request, db=Depends(get_db)):
    project_id = secrets.token_urlsafe(8)
    db.add(
        Project(
            id=project_id,
            name=project.name,
            code=project.code,
            owner_id=await get_user_id_from_request(request),
        )
    )
    await db.commit()
    return {"project_id": project_id}


@app.get("/api/projects/{project_id}")
async def load_project(project_id: str, db=Depends(get_db)):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalars().first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return {"id": project.id, "name": project.name, "code": project.code}


def normalize_breakpoints(value):
    if not isinstance(value, list):
        return []
    return [line for line in value if isinstance(line, int) and line > 0]


@app.websocket("/ws/exec") # rs
async def websocket_exec(websocket: WebSocket):
    await websocket.accept()
    session_id = secrets.token_hex(8)
    pubsub = redis_client.pubsub()

    try:
        request = json.loads(await websocket.receive_text())
        job_data = {
            "session_id": session_id,
            "code": request.get("code", ""),
            "debug": request.get("debug", False),
            "breakpoints": normalize_breakpoints(request.get("breakpoints", [])),
        }
        #moi ui 1 channel
        await pubsub.subscribe(f"stdout:{session_id}", f"status:{session_id}") #output
        await redis_client.rpush(EXEC_QUEUE, json.dumps(job_data))

        async def forward_worker_output():
            try:
                while True:
                    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                    if not message:
                        continue

                    channel = message["channel"]
                    data = message["data"]
                    if channel == f"status:{session_id}" and data == "EXITED":
                        await websocket.send_json({"type": "status", "data": "\r\n[Process Exited]\r\n"})
                        break
                    if channel == f"stdout:{session_id}":
                        await websocket.send_json({"type": "stdout", "data": data})
            finally:
                await pubsub.unsubscribe()

        async def forward_browser_input():
            try:
                while True:
                    message = json.loads(await websocket.receive_text())
                    if message.get("type") == "stdin":
                        await redis_client.publish(f"stdin:{session_id}", message["data"])
            except WebSocketDisconnect:
                await redis_client.publish(f"cancel:{session_id}", "1")

        output_task = asyncio.create_task(forward_worker_output())
        input_task = asyncio.create_task(forward_browser_input())
        _done, pending = await asyncio.wait([output_task, input_task], return_when=asyncio.FIRST_COMPLETED)

        for task in pending:
            task.cancel()

    except WebSocketDisconnect:
        await redis_client.publish(f"cancel:{session_id}", "1")
    except Exception as exc:
        print(f"WebSocket error: {exc}")
        try:
            await websocket.close()
        except Exception:
            pass


frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")