"""Connector-driven reviewed builds, task supervision and durable promotion."""

import copy
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from threading import RLock, Thread
from uuid import uuid4

from .contract import check_connector
from .progress import failure_message, log_tail, save_job, stop_process
from .transactions import Transactions, digest, read_optional, safe_path


def snapshot(root, files):
    return {name: digest(read_optional(safe_path(root, name))) for name in files}


def copy_project(root, destination, files):
    for name in files:
        path = safe_path(destination, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(safe_path(root, name), path)


def runtime_snapshot():
    """Include editable installations in the reviewed verification boundary."""
    root = Path(__file__).resolve().parent
    files = sorted(
        str(path.relative_to(root))
        for path in root.rglob("*")
        if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc"
    )
    return snapshot(root, files)


class ApplyManager:
    def __init__(self, connector):
        check_connector(connector)
        self.connector = connector
        self.workspace = connector.workspace
        self.root = self.workspace.root
        self._environments = {}
        self.lock = RLock()
        self.store = Transactions(self.root, self.workspace.history)
        self.store.recover()
        self.reviews = {}
        self.jobs = {}
        self._workers = {}
        self._processes = {}
        self._restore_jobs()

    def _job_path(self, job_id):
        return safe_path(self.root, f"{self.workspace.reviews}/{job_id}/job.json")

    def _restore_jobs(self):
        records = {r.get("review_id"): r for r in self.store.records()}
        for path in (self.root / self.workspace.reviews).glob("*/job.json"):
            try:
                job = json.loads(path.read_text())
                if job.get("id") != path.parent.name or job.get("status") not in (
                    "running",
                    "failed",
                    "complete",
                ):
                    continue
                if job["status"] == "running" and not self._owner_alive(job):
                    record = records.get(job["id"])
                    if record and record["status"] == "applied":
                        job.update(
                            status="complete",
                            step="Applied to game",
                            transaction=record["id"],
                            files=list(record["files"]),
                            message="Apply completed before the editor stopped. The checked game files were updated.",
                        )
                    else:
                        job.update(
                            status="failed",
                            step="Apply interrupted",
                            failure_kind="interrupted",
                            error="The editor stopped before this Apply finished. No completed update was recorded; review the details before retrying.",
                        )
                    job["ended_at"] = time.time()
                    save_job(path, job)
                self.jobs[job["id"]] = job
            except (OSError, ValueError, TypeError):
                continue

    @staticmethod
    def _owner_alive(job):
        pid = job.get("owner_pid")
        if type(pid) is not int or pid <= 0:
            return False
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True

    def active(self):
        with self.lock:
            ordered = sorted(self.jobs.values(), key=lambda j: j.get("started_at", 0), reverse=True)
            for candidate in ordered:
                job = self.status(candidate["id"])
                if not job.get("acknowledged"):
                    return {"id": job["id"]}
            return {}

    def dismiss(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None or job["status"] == "running":
                raise ValueError("A running or unknown task cannot be dismissed")
            job["acknowledged"] = True
            save_job(self._job_path(job_id), job)

    def _snapshot(self, root):
        return snapshot(root, self.connector.input_files(root))

    def prepare(self, scene):
        self.connector.check_shape(scene)
        review_id = uuid4().hex
        stage = safe_path(self.root, f"{self.workspace.reviews}/{review_id}")
        stage.mkdir(parents=True)
        inputs = self._snapshot(self.root)
        runtime = runtime_snapshot()
        copy_project(self.root, stage, inputs)
        plan = self.connector.prepare(scene, stage, review_id)
        for name in (*plan.sources, *plan.outputs, *plan.artifacts):
            safe_path(stage, name)
        if not set(plan.artifacts) <= set(plan.outputs):
            raise ValueError("Required artifacts must be declared outputs")
        if self._snapshot(self.root) != inputs:
            raise ValueError("Project files changed while preparing review. Try again.")
        if runtime_snapshot() != runtime:
            raise ValueError("Editor package changed while preparing review. Restart the editor.")
        self.reviews[review_id] = {
            "stage": stage,
            "inputs": inputs,
            "runtime": runtime,
            "scene": copy.deepcopy(scene),
            "sources": list(plan.sources),
            "plan": plan,
            "candidate_inputs": self._snapshot(stage),
            "build_before": snapshot(self.root, plan.outputs),
        }
        return dict(plan.review, id=review_id, files=list(plan.sources))

    def start(self, review_id, approved):
        with self.lock:
            if approved is not True:
                raise ValueError("Approve the displayed layout before applying it to the game")
            if any(job["status"] == "running" for job in self.jobs.values()):
                raise ValueError("An apply is already running")
            review = self.reviews.pop(review_id, None)
            if review is None:
                raise ValueError("Review expired. Review the scene again before applying")
            if self._snapshot(self.root) != review["inputs"]:
                raise ValueError(
                    "Project sources changed since review. Review the current revision again."
                )
            if runtime_snapshot() != review["runtime"]:
                raise ValueError("Editor package changed since review. Restart the editor.")
            job = {
                "id": review_id,
                "status": "running",
                "step": review["plan"].checks[0].label
                if review["plan"].checks
                else "Updating project files",
                "log": "",
                "profile": review["scene"]["profile"],
                "owner_pid": os.getpid(),
                "started_at": time.time(),
                "phase_started_at": time.time(),
                "updated_at": time.time(),
                "step_index": 1,
                "step_count": len(review["plan"].checks) + 1,
                "acknowledged": False,
            }
            self.jobs[review_id] = job
            save_job(self._job_path(review_id), job)
            worker = Thread(target=self._run, args=(review, job), daemon=True)
            self._workers[review_id] = worker
            worker.start()
            return dict(job)

    def _command(self, command, stage, log):
        job = self.jobs.get(stage.name)
        with log.open("ab") as stream:
            stream.write(("\n[GBC Scene Forge] " + " ".join(command) + "\n").encode())
            stream.flush()
            with subprocess.Popen(
                command,
                cwd=stage,
                stdout=stream,
                stderr=subprocess.STDOUT,
                env=os.environ | {"PYTHONUNBUFFERED": "1"} | self._environments.get(stage.name, {}),
                start_new_session=True,
            ) as process:
                with self.lock:
                    self._processes[stage.name] = process
                    if job is not None:
                        job["process"] = {
                            "pid": process.pid,
                            "command": " ".join(command),
                            "running": True,
                            "started_at": time.time(),
                            "return_code": None,
                        }
                deadline = time.monotonic() + 900
                try:
                    if job is not None:
                        save_job(self._job_path(job["id"]), job)
                    while True:
                        try:
                            code = process.wait(timeout=1)
                            break
                        except subprocess.TimeoutExpired:
                            with self.lock:
                                if job is not None:
                                    job["updated_at"] = time.time()
                            if time.monotonic() >= deadline:
                                stop_process(process)
                                raise subprocess.TimeoutExpired(command, 900)
                    if code:
                        raise subprocess.CalledProcessError(code, command)
                finally:
                    stop_process(process)
                    with self.lock:
                        self._processes.pop(stage.name, None)
                        if job is not None:
                            job["process"].update(running=False, return_code=process.returncode)

    def _run(self, review, job):
        stage = review["stage"]
        log = stage / "apply.log"
        with self.lock:
            self.jobs.setdefault(job["id"], job)
            job.setdefault("started_at", time.time())
            job.setdefault("phase_started_at", time.time())
            job.setdefault("step", "Preparing reviewed layout")
            job.setdefault("owner_pid", os.getpid())
            job.setdefault("profile", review["scene"]["profile"])
        try:
            if runtime_snapshot() != review["runtime"]:
                raise ValueError("Editor package changed since review. Restart the editor.")
            if self._snapshot(stage) != review["candidate_inputs"]:
                raise ValueError("The staged layout changed after review. Review the scene again.")
            plan = review["plan"]
            self.connector.approve(plan, stage, job["id"])
            outputs = set(plan.outputs)
            frozen = {
                name: value for name, value in self._snapshot(stage).items() if name not in outputs
            }
            self._environments[stage.name] = plan.environment
            commands = [(step.label, list(step.command)) for step in plan.checks]
            for index, (label, command) in enumerate(commands, 1):
                with self.lock:
                    job.update(
                        step=label,
                        step_index=index,
                        step_count=len(commands) + 1,
                        phase_started_at=time.time(),
                        updated_at=time.time(),
                    )
                    save_job(self._job_path(job["id"]), job)
                self._command(command, stage, log)
            if any(not safe_path(stage, name).is_file() for name in plan.artifacts):
                raise ValueError("Verification did not produce the declared artifacts")
            checked = {
                name: value for name, value in self._snapshot(stage).items() if name not in outputs
            }
            if checked != frozen:
                raise ValueError(
                    "Reviewed source files changed during verification. No game files were applied."
                )
            if runtime_snapshot() != review["runtime"]:
                raise ValueError(
                    "Editor package changed during verification. No game files were applied."
                )
            with self.lock:
                if self._snapshot(self.root) != review["inputs"]:
                    raise ValueError(
                        "Project sources changed during verification. No game files were applied; review again."
                    )
                names = list(dict.fromkeys((*plan.sources, *plan.outputs)))
                changes = {
                    name: (stage / name).read_bytes()
                    for name in names
                    if (stage / name).is_file()
                    and (stage / name).read_bytes() != read_optional(safe_path(self.root, name))
                }
                expected = review["inputs"] | review["build_before"]
                job["step"] = "Updating game files"
                job.update(step_index=len(plan.checks) + 1, phase_started_at=time.time())
                record = self.store.apply(
                    changes, expected, review["scene"]["name"], review_id=job["id"]
                )
                atomic_log = self.store.record_path(record["id"]).parent / "checks.log"
                try:
                    shutil.copyfile(log, atomic_log)
                except OSError:
                    # A report-copy error does not turn a committed apply into a failure.
                    # Its original log is still in the isolated review directory.
                    pass
                job.update(
                    status="complete",
                    step="Applied to game",
                    transaction=record["id"],
                    profile=review["scene"]["profile"],
                    files=list(changes),
                    message=plan.message,
                )
        except BaseException as error:
            with self.lock:
                step = job["step"]
                job.update(
                    status="failed",
                    step="Apply stopped",
                    failed_step=step,
                    failure_kind="timeout"
                    if isinstance(error, subprocess.TimeoutExpired)
                    else "error",
                    error=failure_message(error, step),
                )
        finally:
            with self.lock:
                job["ended_at"] = time.time()
                job["updated_at"] = job["ended_at"]
                try:
                    job["log"] = log_tail(log)[0]
                    save_job(self._job_path(job["id"]), job)
                except OSError as error:
                    job["report_error"] = f"Could not save task report: {error}"

    def status(self, job_id):
        with self.lock:
            if job_id not in self.jobs:
                raise ValueError("Unknown apply job")
            job = self.jobs[job_id]
            if job["status"] == "running":
                if job.get("owner_pid", os.getpid()) != os.getpid():
                    saved = self._job_path(job_id)
                    if saved.is_file():
                        job.update(json.loads(saved.read_text()))
                worker = self._workers.get(job_id)
                if (worker is not None and not worker.is_alive()) or not self._owner_alive(job):
                    job.update(
                        status="failed",
                        step="Apply stopped",
                        failure_kind="worker_stopped",
                        error="The background worker stopped without completing. Review the task log and current game before retrying.",
                        ended_at=time.time(),
                    )
                    save_job(self._job_path(job_id), job)
            result = dict(job)
            log = self.root / self.workspace.reviews / job_id / "apply.log"
            text, size, modified = log_tail(log)
            result.update(
                log=text,
                log_bytes=size,
                last_output_at=modified,
                server_time=time.time(),
                worker_alive=(
                    self._workers[job_id].is_alive()
                    if job_id in self._workers
                    else self._owner_alive(job)
                ),
            )
            result["activity"] = self.connector.activity(text, result["step"])
            return result

    def close(self):
        with self.lock:
            processes = list(self._processes.values())
            workers = list(self._workers.values())
        for process in processes:
            stop_process(process)
        for worker in workers:
            worker.join(timeout=5)

    def undo(self, transaction_id):
        with self.lock:
            if any(j["status"] == "running" for j in self.jobs.values()):
                raise ValueError("Wait for the current apply to finish before undoing")
            return self.store.undo(transaction_id)
