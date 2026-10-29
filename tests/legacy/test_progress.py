"""Process health and failure reporting use disposable jobs and short child processes."""

import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from threading import Thread
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch
from uuid import uuid4

from gbc_scene_forge.legacy.apply import ApplyManager
from gbc_scene_forge.legacy.progress import LOG_LIMIT, failure_message, log_tail, save_job
from gbc_scene_forge.storage.files import digest
from legacy.fixture_connector import FixtureConnector


class ProgressTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.manager = ApplyManager(FixtureConnector(self.root))
        self.job_id = uuid4().hex
        self.stage = self.root / self.manager.workspace.reviews / self.job_id
        self.stage.mkdir(parents=True)
        self.log = self.stage / "apply.log"
        self.job = {
            "id": self.job_id,
            "status": "running",
            "step": "Running checks",
            "profile": "workbench",
            "owner_pid": os.getpid(),
            "started_at": time.time(),
            "phase_started_at": time.time(),
            "acknowledged": False,
        }
        self.manager.jobs[self.job_id] = self.job

    def test_live_process_and_output_are_visible_before_it_exits(self):
        command = [
            sys.executable,
            "-c",
            "import time; print('process started'); time.sleep(0.5); print('done')",
        ]
        errors = []

        def run():
            try:
                self.manager._command(command, self.stage, self.log)
            except Exception as error:
                errors.append(error)

        worker = Thread(target=run)
        self.manager._workers[self.job_id] = worker
        worker.start()
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                report = self.manager.status(self.job_id)
                if "process started" in report["log"].splitlines():
                    break
                time.sleep(0.01)
            self.assertIn("process started", report["log"])
            self.assertTrue(report["worker_alive"])
            self.assertTrue(report["process"]["running"])
            self.assertGreater(report["last_output_at"], 0)
            self.assertGreater(report["server_time"], 0)
        finally:
            worker.join(timeout=5)
        self.assertFalse(errors)
        self.assertFalse(self.job["process"]["running"])
        self.assertEqual(self.job["process"]["return_code"], 0)

    def test_failed_child_keeps_exit_code_and_error_output(self):
        command = [sys.executable, "-c", "print('injected compiler failure'); raise SystemExit(7)"]
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            self.manager._command(command, self.stage, self.log)
        self.assertEqual(caught.exception.returncode, 7)
        self.assertEqual(self.job["process"]["return_code"], 7)
        self.assertIn("injected compiler failure", self.manager.status(self.job_id)["log"])
        self.assertIn("exit code 7", failure_message(caught.exception, "Building ROM"))

    def test_command_timeout_stops_the_owned_process_group(self):
        process = Mock(pid=12345, returncode=-15)
        process.wait.side_effect = subprocess.TimeoutExpired("test", 1)
        factory = MagicMock()
        factory.return_value.__enter__.return_value = process
        factory.return_value.__exit__.return_value = False
        with (
            patch("gbc_scene_forge.legacy.apply.subprocess.Popen", factory),
            patch("gbc_scene_forge.legacy.apply.time.monotonic", side_effect=[0, 901]),
            patch("gbc_scene_forge.legacy.apply.stop_process") as stop,
        ):
            with self.assertRaises(subprocess.TimeoutExpired) as caught:
                self.manager._command(["fake-command"], self.stage, self.log)
        self.assertEqual(caught.exception.timeout, 900)
        stop.assert_called_with(process)
        self.assertIn("time limit", failure_message(caught.exception, "Campaign checks"))

    def test_dead_worker_is_a_failure_instead_of_an_endless_spinner(self):
        self.manager._workers[self.job_id] = SimpleNamespace(is_alive=lambda: False)
        report = self.manager.status(self.job_id)
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["failure_kind"], "worker_stopped")
        self.assertIn("stopped", report["error"])

    def test_interrupted_task_is_reported_after_restart_until_dismissed(self):
        self.job["owner_pid"] = -1
        save_job(self.stage / "job.json", self.job)
        restarted = ApplyManager(FixtureConnector(self.root))
        report = restarted.status(self.job_id)
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["failure_kind"], "interrupted")
        self.assertEqual(restarted.active(), {"id": self.job_id})
        restarted.dismiss(self.job_id)
        self.assertEqual(ApplyManager(FixtureConnector(self.root)).active(), {})

    def test_committed_task_is_recovered_as_success_after_restart(self):
        target = self.root / "map.txt"
        target.write_bytes(b"old")
        record = self.manager.store.apply(
            {"map.txt": b"new"}, {"map.txt": digest(b"old")}, "Example", review_id=self.job_id
        )
        self.job["owner_pid"] = -1
        save_job(self.stage / "job.json", self.job)
        restarted = ApplyManager(FixtureConnector(self.root))
        report = restarted.status(self.job_id)
        self.assertEqual(report["status"], "complete")
        self.assertEqual(report["transaction"], record["id"])
        self.assertEqual(target.read_bytes(), b"new")

    def test_logs_are_bounded_and_activity_names_follow_actual_output(self):
        self.log.write_text("x" * (LOG_LIMIT * 4))
        text, size, modified = log_tail(self.log)
        self.assertEqual(len(text), LOG_LIMIT)
        self.assertEqual(size, LOG_LIMIT * 4)
        self.assertIsNotNone(modified)
        self.assertIn(
            "signal 15", failure_message(subprocess.CalledProcessError(-15, "test"), "Test")
        )


if __name__ == "__main__":
    unittest.main()
