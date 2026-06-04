from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import subprocess 
import tempfile
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CodeRequest(BaseModel):
    code: str
    stdin: str=''

@app.post("/run")
def run_code(req: CodeRequest):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(req.code)
        filename = f.name
    try:
        result = subprocess.run(
            ["python", filename],
            input=req.stdin,
            capture_output=True,
            text=True,
            timeout=5
        )
        return {
            "output": result.stdout,
            "error": result.stderr }
    finally:
        os.remove(filename)