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
    stdin: str = ''

@app.post("/run")
def run_code(req: CodeRequest):
    with tempfile.TemporaryDirectory() as temp_dir:
        source_path = os.path.join(temp_dir, "main.c")
        
        with open(source_path, "w") as f:
            f.write(req.code)
            
        abs_temp_dir = os.path.abspath(temp_dir)
        
        docker_cmd = [
            "docker", "run", "-i",
            "--network", "none",
            "--memory", "256m",
            "--cpus", "0.5",
            "-v", f"{abs_temp_dir}:/app",
            "-w", "/app",
            "gcc:latest",
            "sh", "-c", "gcc main.c -o main && timeout 5 ./main" 
        ]

        try:
            result = subprocess.run(
                docker_cmd,
                input=req.stdin,
                capture_output=True,
                text=True,
                timeout=10
            )
            print("DOCKER STDOUT:", result.stdout)
            return {
                "output": result.stdout,
                "error": result.stderr 
            }
        except subprocess.TimeoutExpired:
            return {"error": "Execution timed out (Max 5 seconds allowed)."}
        except Exception as e:
            return {"error": f"Internal server error: {str(e)}"}