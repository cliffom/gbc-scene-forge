"""Thread-safe server status, live client total and recent HTTP client activity."""

import json
import os
import sys
import time
from threading import Lock

CLIENT_TIMEOUT = 120


class ServerConsole:
    def __init__(self, stream=None, *, clock=time.monotonic, timeout=CLIENT_TIMEOUT):
        self.stream = stream if stream is not None else sys.stdout
        self.clock = clock
        self.timeout = timeout
        self.clients = {}
        self.lock = Lock()
        self.interactive = self.stream.isatty() and os.environ.get("TERM") != "dumb"
        self.color = self.interactive and "NO_COLOR" not in os.environ
        self.live_total = False

    def highlight(self, text, code):
        return f"\033[{code}m{text}\033[0m" if self.color else text

    def write(self, text):
        if self.live_total:
            # The total occupies the current line. Insert ledger entries above it,
            # then replace it with the current count; never leave a stale total behind.
            self.stream.write("\r\033[2K")
        print(text, file=self.stream, flush=True)
        if self.live_total:
            self._total()

    def _total(self):
        print(
            "  Clients  " + self.highlight(f"{len(self.clients)} active", "36"),
            end="",
            file=self.stream,
            flush=True,
        )

    def start(self, port):
        with self.lock:
            self.write("Scene Forge")
            self.write("  Status   " + self.highlight("online", "32"))
            self.write("  Editor   " + self.highlight(f"http://127.0.0.1:{port}/", "36"))
            self.write(
                f"  Activity expires after {self.timeout}s without a request. Ctrl+C to stop."
            )
            self.live_total = self.interactive
            if self.live_total:
                self._total()
            else:
                self.write("  Clients  " + self.highlight("0 active", "36"))

    def stop(self):
        with self.lock:
            if self.live_total:
                print(file=self.stream, flush=True)
                self.live_total = False
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
        self.write(
            f"{event} client {json.dumps(ip)} | User-Agent: {json.dumps(agent)} | "
            + self.highlight(f"Clients: {len(self.clients)} active", "36")
        )

    def request(self, ip, agent, request_line, status):
        with self.lock:
            now = self.clock()
            self._expire(now)
            identity = (ip, agent)
            new = identity not in self.clients
            self.clients[identity] = now
            if new:
                self._client_event("New", identity)
            if int(status) >= 400:
                self.write(
                    self.highlight(f"HTTP {status}", "31" if int(status) >= 500 else "33")
                    + f" | {json.dumps(ip)} | {json.dumps(request_line)}"
                )

    def error(self, message):
        with self.lock:
            self.write(self.highlight("Error", "31") + " | " + json.dumps(message))
