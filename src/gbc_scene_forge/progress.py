"""Read bounded process output and describe observable Apply activity."""

import os
import signal
import subprocess

from .transactions import atomic_write, record_bytes

LOG_LIMIT = 24000


def log_tail(path):
    try:
        with path.open("rb") as stream:
            stream.seek(0, 2)
            size = stream.tell()
            stream.seek(max(0, size - LOG_LIMIT))
            text = stream.read().decode(errors="replace")
        return text, size, path.stat().st_mtime
    except FileNotFoundError:
        return "", 0, None


def failure_message(error, step):
    if isinstance(error, subprocess.TimeoutExpired):
        return f"{step} exceeded its {error.timeout:g}-second time limit. Its process was stopped."
    if isinstance(error, subprocess.CalledProcessError):
        if error.returncode < 0:
            return f"{step} was terminated by signal {-error.returncode}."
        return f"{step} failed (exit code {error.returncode}). See the error output below."
    return str(error) or f"{step} stopped unexpectedly."


def stop_process(process):
    """Stop the owned command and its compiler/emulator children as a group."""
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    except ProcessLookupError:
        pass


def save_job(path, job):
    atomic_write(path, record_bytes({k: v for k, v in job.items() if k != "log"}))
