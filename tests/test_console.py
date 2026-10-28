"""Console rendering, identity, inactivity and standalone HTTP logging."""

import io
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from unittest.mock import patch

from gbc_scene_forge.console import ServerConsole
from gbc_scene_forge.standalone import StandaloneServer, make_handler, make_root_handler


class ConsoleTests(unittest.TestCase):
    def test_plain_startup_and_terminal_colors(self):
        for tty, env, colored in (
            (False, {}, False),
            (True, {}, True),
            (True, {"NO_COLOR": ""}, False),
            (True, {"TERM": "dumb"}, False),
        ):
            with self.subTest(tty=tty, env=env), patch.dict("os.environ", env, clear=True):
                stream = io.StringIO()
                stream.isatty = lambda: tty
                console = ServerConsole(stream)
                console.start(8765)
                console.request("127.0.0.1", "Browser", "GET /missing HTTP/1.1", 404)
                console.request("127.0.0.1", "Browser", "GET /broken HTTP/1.1", 500)
                console.stop()
                output = stream.getvalue()
                for text in ("online", "http://127.0.0.1:8765/", "0 active", "stopped", "HTTP 404"):
                    self.assertIn(text, output)
                self.assertEqual("\033[" in output, colored)

    def test_identity_refresh_expiration_and_return(self):
        now = [0]
        stream = io.StringIO()
        console = ServerConsole(stream, clock=lambda: now[0])
        console.request("127.0.0.1", "Browser A", "GET / HTTP/1.1", 200)
        console.request("127.0.0.1", "Browser B", "GET / HTTP/1.1", 200)
        console.request("127.0.0.2", "Browser A", "GET / HTTP/1.1", 200)
        now[0] = 60
        console.request("127.0.0.1", "Browser A", "GET /asset HTTP/1.1", 200)
        now[0] = 120
        console.expire()
        self.assertEqual(len(console.clients), 1)
        now[0] = 180
        console.expire()
        self.assertEqual(len(console.clients), 0)
        self.assertIn("Clients: 0 active", stream.getvalue())
        console.request("127.0.0.1", "Browser A", "GET / HTTP/1.1", 200)
        self.assertEqual(stream.getvalue().count("New client"), 4)
        self.assertEqual(stream.getvalue().count("Inactive client"), 3)
        self.assertNotIn("GET /", stream.getvalue())

    def test_concurrent_requests_count_one_identity_and_escape_untrusted_text(self):
        stream = io.StringIO()
        console = ServerConsole(stream)
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(
                pool.map(
                    lambda _: console.request("127.0.0.1", "A\033[31m\nB", "/", 200), range(50)
                )
            )
        console.error("bad\033[31m\nmessage")
        self.assertEqual(len(console.clients), 1)
        self.assertEqual(stream.getvalue().count("New client"), 1)
        self.assertNotIn("\033", stream.getvalue())
        self.assertIn(r"\u001b", stream.getvalue())
        self.assertEqual(len(stream.getvalue().splitlines()), 2)

    def test_http_logging_and_idle_expiry_in_both_launch_modes(self):
        for factory in (make_handler, make_root_handler):
            with self.subTest(factory=factory.__name__), tempfile.TemporaryDirectory() as root:
                expired = threading.Event()

                class Stream(io.StringIO):
                    def write(self, text):
                        result = super().write(text)
                        if "Clients: 0 active" in text:
                            expired.set()
                        return result

                now = [0]
                stream = Stream()
                with StandaloneServer(("127.0.0.1", 0), factory(root, "secret")) as server:
                    server.console = ServerConsole(stream, clock=lambda: now[0])
                    thread = threading.Thread(
                        target=lambda: server.serve_forever(poll_interval=0.01)
                    )
                    thread.start()
                    try:

                        def request(path, agent="Browser A", method="GET", headers=None):
                            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=2)
                            try:
                                connection.request(
                                    method, path, headers={"User-Agent": agent, **(headers or {})}
                                )
                                response = connection.getresponse()
                                response.read()
                                return response.status
                            finally:
                                connection.close()

                        self.assertEqual(request("/api/project"), 200)
                        self.assertEqual(request("/api/project"), 200)
                        self.assertEqual(request("/api/project", "Browser B"), 200)
                        self.assertEqual(stream.getvalue().count("New client"), 2)
                        self.assertNotIn("GET /api/project", stream.getvalue())
                        self.assertEqual(request("/missing"), 404)
                        self.assertEqual(request("/api/create-project", method="POST"), 403)
                        self.assertEqual(request("/", headers={"Host": "evil.example"}), 403)
                        self.assertEqual(request("/", method="DELETE"), 501)
                        for status in (403, 404, 501):
                            self.assertIn(f"HTTP {status}", stream.getvalue())
                        now[0] = 120
                        self.assertTrue(expired.wait(2), "Idle server did not expire clients")
                        self.assertEqual(len(server.console.clients), 0)
                    finally:
                        server.shutdown()
                        thread.join(timeout=2)
