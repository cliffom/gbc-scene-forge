"""Thread-safe server status, live client total and recent HTTP client activity."""

import json
import logging
import os
import sys
import time
from threading import Lock

CLIENT_TIMEOUT = 120


class ServerConsole:
    def __init__(
        self,
        stream=None,
        *,
        logger=None,
        log_path=None,
        clock=time.monotonic,
        timeout=CLIENT_TIMEOUT,
    ):
        self.stream = stream if stream is not None else sys.stdout
        self.clock = clock
        self.timeout = timeout
        self.clients = {}
        self.lock = Lock()
        self.interactive = self.stream.isatty() and os.environ.get("TERM") != "dumb"
        self.color = self.interactive and "NO_COLOR" not in os.environ
        self.live_total = False
        self.logger = logger if logger is not None else logging.Logger(__name__)
        if logger is None:
            self.logger.addHandler(logging.NullHandler())
        self.log_path = log_path
        self.failures = 0

    def highlight(self, text, code):
        return f"\033[{code}m{text}\033[0m" if self.color else text

    def write(self, text):
        print(text, file=self.stream, flush=True)

    def _total(self):
        if self.live_total:
            self.stream.write("\r\033[2K")
        print(
            f"  {'Clients':<14}"
            + self.highlight(f"{len(self.clients)} active", "36")
            + " | Failures "
            + self.highlight(str(self.failures), "33" if self.failures else "36"),
            end="" if self.live_total else "\n",
            file=self.stream,
            flush=True,
        )

    def start(self, port, *, project_root=None):
        with self.lock:
            self.write("Scene Forge")
            self.write(f"  {'Status':<14}" + self.highlight("online", "32"))
            self.write(f"  {'Editor':<14}" + self.highlight(f"http://127.0.0.1:{port}/", "36"))
            if project_root is not None:
                self.write(f"  {'Project Root':<14}" + json.dumps(str(project_root)))
            if self.log_path is not None:
                self.write(f"  {'Log':<14}" + json.dumps(str(self.log_path)))
            self.write(
                f"  Activity expires after {self.timeout}s without a request. Ctrl+C to stop."
            )
            self.live_total = self.interactive
            self._total()

    def stop(self):
        with self.lock:
            if self.live_total:
                print(file=self.stream, flush=True)
                self.live_total = False
            else:
                self._total()
            self.write("Status   " + self.highlight("stopped", "33"))

    def expire(self):
        with self.lock:
            self._expire(self.clock())

    def _expire(self, now):
        for identity, last_seen in list(self.clients.items()):
            if now - last_seen >= self.timeout:
                del self.clients[identity]
                self._client_event("Inactive", identity)

    def _client_event(self, event, identity):
        ip, agent = identity
        self.logger.info(
            f"{event} client {json.dumps(ip)} | User-Agent: {json.dumps(agent)} | "
            + f"Clients: {len(self.clients)} active"
        )
        if self.live_total:
            self._total()

    def request(self, ip, agent, request_line, status):
        with self.lock:
            now = self.clock()
            self._expire(now)
            identity = (ip, agent)
            new = identity not in self.clients
            self.clients[identity] = now
            if new:
                self._client_event("New", identity)
            self.logger.info(
                "HTTP %s | %s | %s | User-Agent: %s",
                status,
                json.dumps(ip),
                json.dumps(request_line),
                json.dumps(agent),
            )
            if int(status) >= 400:
                self.failures += 1
                if self.live_total:
                    self._total()

    def error(self, message, *, count_failure=True):
        with self.lock:
            self.logger.error("Error | %s", json.dumps(message))
            if count_failure:
                self.failures += 1
                if self.live_total:
                    self._total()
