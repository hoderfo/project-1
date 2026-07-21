import json
import os
import shutil
import tempfile
import threading
import time

import docker
import redis

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6380")
EXEC_QUEUE = os.getenv("EXEC_QUEUE", "c_ide_jobs")
DOCKER_IMAGE = os.getenv("DOCKER_IMAGE", "c_ide_env")
GDB_COMMAND_PREFIX = "__GDB_MI__:"
IO_HELPER_CODE = (
    "#include <stdio.h>\n"
    "__attribute__((constructor)) static void __ide_unbuffer_stdio(void) { "
    "setvbuf(stdout, NULL, _IONBF, 0); "
    "setvbuf(stderr, NULL, _IONBF, 0); "
    "}\n"
)

redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
docker_client = docker.from_env()


def publish_stdout(session_id, text):
    redis_client.publish(f"stdout:{session_id}", text)
#send output to redis channel 

def publish_exit(session_id):
    redis_client.publish(f"status:{session_id}", "EXITED")


def cleanup_job_dir(temp_dir):
    shutil.rmtree(temp_dir, ignore_errors=True)


def decode_output(data):
    return data.decode("utf-8", errors="replace")


def load_source_files(code):
    try:
        files = json.loads(code)
        if isinstance(files, dict):
            return files
    except Exception:
        pass
    return {"main.c": code}


def write_source_files(temp_dir, files):
    for filename, content in files.items():
        safe_filename = os.path.basename(filename)
        code_path = os.path.join(temp_dir, safe_filename)
        with open(code_path, "w", encoding="utf-8") as file:
            file.write(content)

    helper_path = os.path.join(temp_dir, "__ide_io.c")
    with open(helper_path, "w", encoding="utf-8") as file:
        file.write(IO_HELPER_CODE)


def compile_sources(session_id, app_dir):
    try:
        print(f"[{session_id}] Compiling...")
        docker_client.containers.run(
            DOCKER_IMAGE,
            command='sh -c "gcc -g -o /app/main /app/*.c"',
            volumes={app_dir: {"bind": "/app", "mode": "rw"}},
            remove=True,
        )
        print(f"[{session_id}] Compilation done.")
        return True
    except docker.errors.ContainerError as exc:
        print(f"[{session_id}] Compilation failed")
        publish_stdout(session_id, f"Compilation Error:\n{decode_output(exc.stderr)}")
        publish_exit(session_id)
        return False
    except Exception as exc:
        print(f"[{session_id}] Error compiling: {exc}")
        publish_stdout(session_id, f"Error: {exc}\n")
        publish_exit(session_id)
        return False


def create_container(command, app_dir):
    return docker_client.containers.create(
        DOCKER_IMAGE,
        command=command,
        volumes={app_dir: {"bind": "/app", "mode": "rw"}},
        working_dir="/app",
        stdin_open=True,
        tty=True,
        detach=True,
    )


def stream_output(sock, session_id, stop_event):
    sock.settimeout(0.5)
    try:
        while not stop_event.is_set():
            try:
                data = sock.recv(4096)
                if not data:
                    break
                publish_stdout(session_id, decode_output(data))
            except Exception:
                pass
    except Exception as exc:
        print(f"[{session_id}] Output error: {exc}")
    finally:
        publish_exit(session_id)


def handle_input(sock, session_id, pubsub, stop_event, container):
    stdin_channel = f"stdin:{session_id}"
    cancel_channel = f"cancel:{session_id}"
    pubsub.subscribe(stdin_channel, cancel_channel)

    try:
        for message in pubsub.listen():
            if stop_event.is_set():
                break
            if message["type"] != "message":
                continue

            if message["channel"] == cancel_channel:
                stop_event.set()
                try:
                    container.kill()
                except Exception:
                    pass
                break

            try:
                sock.send(message["data"].encode("utf-8"))
            except Exception as exc:
                print(f"[{session_id}] Failed to send stdin: {exc}")
                break
    finally:
        pubsub.unsubscribe(stdin_channel, cancel_channel)


def run_program(session_id, app_dir):
    container = create_container("/app/main", app_dir)
    sock = container.attach_socket(params={"stdin": 1, "stdout": 1, "stderr": 1, "stream": 1})
    raw_sock = getattr(sock, "_sock", sock)
    stop_event = threading.Event()
    pubsub = redis_client.pubsub()

    output_thread = threading.Thread(target=stream_output, args=(raw_sock, session_id, stop_event))
    input_thread = threading.Thread(target=handle_input, args=(raw_sock, session_id, pubsub, stop_event, container))
    output_thread.start()
    input_thread.start()

    print(f"[{session_id}] Starting run container...")
    container.start()
    container.wait()
    stop_event.set()
    redis_client.publish(f"stdin:{session_id}", "")
    time.sleep(0.5)

    try:
        sock.close()
    except Exception:
        pass

    input_thread.join(timeout=1.0)
    output_thread.join(timeout=1.0)
    container.remove()
    print(f"[{session_id}] Job finished")

#debug
def run_debugger(session_id, app_dir, breakpoints):
    from pygdbmi.gdbmiparser import parse_response

    container = create_container("gdb --interpreter=mi /app/main", app_dir)
    sock = container.attach_socket(params={"stdin": 1, "stdout": 1, "stderr": 1, "stream": 1})
    raw_sock = getattr(sock, "_sock", sock)
    raw_sock.settimeout(0.5)
    stop_event = threading.Event()

    def send_gdb_command(command):
        try:
            raw_sock.send((command.rstrip() + "\n").encode("utf-8"))
        except Exception as exc:
            print(f"[{session_id}] Failed to send GDB command: {exc}")

    def publish_gdb_response(response):
        if response.get("type") == "target":
            publish_stdout(session_id, response.get("payload", ""))
            return

        publish_stdout(session_id, f"\r\n[GDB] {json.dumps(response)}\r\n")
        if response.get("message") != "stopped":
            return

        reason = response.get("payload", {}).get("reason")
        if reason == "exited-normally":
            send_gdb_command("-gdb-exit")
        else:
            send_gdb_command("-stack-list-frames")
            send_gdb_command("-stack-list-variables --all-values")

    def publish_gdb_line(line):
        line = line.strip("\r")
        if not line:
            return True
        try:
            publish_gdb_response(parse_response(line))
            return True
        except Exception:
            if line.startswith("@") or line.startswith("~") or line.startswith("&"):
                return False
            publish_stdout(session_id, line + "\r\n")
            return True

    def gdb_output_loop():
        buffer = ""
        while not stop_event.is_set():
            try:
                data = raw_sock.recv(4096)
                if not data:
                    break
                buffer += decode_output(data)
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    publish_gdb_line(line)
            except Exception:
                if buffer and publish_gdb_line(buffer):
                    buffer = ""

    def gdb_input_loop():
        pubsub = redis_client.pubsub()
        stdin_channel = f"stdin:{session_id}"
        cancel_channel = f"cancel:{session_id}"
        pubsub.subscribe(stdin_channel, cancel_channel)

        try:
            for message in pubsub.listen():
                if stop_event.is_set():
                    break
                if message["type"] != "message":
                    continue

                data = message["data"]
                if message["channel"] == cancel_channel:
                    stop_event.set()
                    send_gdb_command("-gdb-exit")
                    try:
                        container.kill()
                    except Exception:
                        pass
                    break
                if data.startswith(GDB_COMMAND_PREFIX):
                    command = data[len(GDB_COMMAND_PREFIX):].strip()
                    if command:
                        send_gdb_command(command)
                elif data:
                    try:
                        raw_sock.send(data.encode("utf-8"))
                    except Exception as exc:
                        print(f"[{session_id}] Failed to send debug stdin: {exc}")
                        break
        finally:
            pubsub.unsubscribe(stdin_channel, cancel_channel)

    output_thread = threading.Thread(target=gdb_output_loop)
    input_thread = threading.Thread(target=gdb_input_loop)
    output_thread.start()
    input_thread.start()

    print(f"[{session_id}] Starting GDB debugger...")
    container.start()
    time.sleep(0.5)
    for line in breakpoints:
        send_gdb_command(f"-break-insert main.c:{line}")
    send_gdb_command("-exec-run")

    container.wait()
    stop_event.set()
    redis_client.publish(f"stdin:{session_id}", "")

    try:
        sock.close()
    except Exception:
        pass

    input_thread.join(timeout=1.0)
    output_thread.join(timeout=1.0)
    container.remove()
    publish_exit(session_id)
    print(f"[{session_id}] Debug job finished")


def run_job(job_data):
    session_id = job_data["session_id"]
    is_debug = job_data.get("debug", False)
    print(f"[{session_id}] Starting job (debug={is_debug})")

    workspace_temp = os.path.join(os.getcwd(), "temp")
    os.makedirs(workspace_temp, exist_ok=True)
    temp_dir = tempfile.mkdtemp(dir=workspace_temp, prefix=f"{session_id}_")
    app_dir = os.path.abspath(temp_dir)

    try:
        write_source_files(temp_dir, load_source_files(job_data.get("code", "")))
        if not compile_sources(session_id, app_dir):
            return

        if is_debug:
            run_debugger(session_id, app_dir, job_data.get("breakpoints", []))
        else:
            run_program(session_id, app_dir)
    finally:
        cleanup_job_dir(temp_dir)

#worker 
def worker_loop():
    print("Worker started. Listening for jobs...")
    while True:
        try:
            result = redis_client.blpop(EXEC_QUEUE, timeout=5)
            if not result:
                continue

            _queue_name, data = result
            threading.Thread(target=run_job, args=(json.loads(data),)).start()
        except redis.exceptions.TimeoutError:
            pass
        except Exception as exc:
            if "Timeout reading from socket" not in str(exc):
                print(f"Worker loop error: {exc}")
            time.sleep(1)


if __name__ == "__main__":
    worker_loop()