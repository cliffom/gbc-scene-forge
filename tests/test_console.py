"""Console rendering, identity, inactivity and standalone HTTP logging."""

import errno
import io
import logging
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from pathlib import Path
from socket import create_connection
from unittest.mock import patch

from gbc_scene_forge.build_info import build_version
from gbc_scene_forge.console import ServerConsole
from gbc_scene_forge.png import decode
from gbc_scene_forge.standalone import (
    StandaloneServer,
    make_handler,
    make_root_handler,
    open_editor,
    serve,
)


class ConsoleTests(unittest.TestCase):
    def test_launcher_writes_timestamped_rotating_log_and_compact_output(self):
        with tempfile.TemporaryDirectory() as folder:
            server = unittest.mock.MagicMock()
            server.__enter__.return_value = server
            server.server_port = 8765

            def traffic():
                for index in range(100):
                    server.console.request("127.0.0.1", "Browser", f"GET /{index} HTTP/1.1", 200)
                server.console.request("127.0.0.1", "Browser", "GET /missing HTTP/1.1", 404)
                server.console.error("Protocol error")
                server.console.logger.handlers[0].flush()
                raise KeyboardInterrupt

            server.serve_forever.side_effect = traffic
            stream = io.StringIO()
            with (
                patch("gbc_scene_forge.standalone.StandaloneServer", return_value=server),
                patch("gbc_scene_forge.standalone.make_root_handler"),
                patch("gbc_scene_forge.standalone.Path.cwd", return_value=Path(folder)),
                patch("sys.stdout", stream),
            ):
                serve(Path(folder) / "projects")
                handler = server.console.logger.handlers[0]
                self.assertEqual(handler.maxBytes, 1024 * 1024)
                self.assertEqual(handler.backupCount, 3)
                self.assertIsNone(handler.stream)
                serve(Path(folder) / "projects")
            path = Path(folder) / ".forge-logs/server-8765.log"
            log = path.read_text()
            self.assertEqual(log.count("HTTP 200"), 200)
            self.assertEqual(log.count("HTTP 404"), 2)
            self.assertIn("Protocol error", log)
            self.assertRegex(log, r"\d{4}-\d{2}-\d{2} .* INFO HTTP 200")
            self.assertIn(str(path), stream.getvalue())
            lines = stream.getvalue().splitlines()
            editor_line = next(index for index, line in enumerate(lines) if "Editor" in line)
            self.assertIn("Version", lines[editor_line + 1])
            self.assertIn(build_version(), lines[editor_line + 1])
            self.assertIn("Project Root", lines[editor_line + 2])
            self.assertIn(str(Path(folder) / "projects"), lines[editor_line + 2])
            self.assertIn("Failures 2", stream.getvalue())
            self.assertNotIn("GET /", stream.getvalue())
            self.assertNotIn("New client", stream.getvalue())
            self.assertNotIn("\033", stream.getvalue() + log)
            self.assertLess(len(stream.getvalue().splitlines()), 22)

    def test_browser_opens_actual_bound_port_and_failure_keeps_url_available(self):
        for result in (False, OSError("no desktop")):
            with (
                self.subTest(result=result),
                patch("gbc_scene_forge.standalone.webbrowser.open") as browser,
                patch("sys.stdout", new_callable=io.StringIO) as output,
            ):
                if isinstance(result, Exception):
                    browser.side_effect = result
                else:
                    browser.return_value = result
                open_editor("http://127.0.0.1:12345/")
                browser.assert_called_once_with("http://127.0.0.1:12345/")
                self.assertIn("Open http://127.0.0.1:12345/ manually", output.getvalue())
        with tempfile.TemporaryDirectory() as folder:
            with (
                patch("gbc_scene_forge.standalone.StandaloneServer") as server_type,
                patch("gbc_scene_forge.standalone.Thread") as thread,
                patch("gbc_scene_forge.standalone.Path.cwd", return_value=Path(folder)),
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                server = server_type.return_value
                server.server_port = 12345
                server.serve_forever.side_effect = KeyboardInterrupt
                serve(Path(folder) / "projects", 0, open_browser=True)
                self.assertEqual(thread.call_args.kwargs["args"], ("http://127.0.0.1:12345/",))
                thread.return_value.start.assert_called_once()
            with (
                patch(
                    "gbc_scene_forge.standalone.StandaloneServer",
                    side_effect=OSError(errno.EADDRINUSE, "busy"),
                ),
                self.assertRaisesRegex(ValueError, "--port 8777"),
            ):
                serve(Path(folder) / "projects")

    def make_console(self, stream, **kwargs):
        self.activity = io.StringIO()
        logger = logging.Logger("test.activity", level=logging.INFO)
        logger.addHandler(logging.StreamHandler(self.activity))
        return ServerConsole(stream, logger=logger, **kwargs)

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
                console = self.make_console(stream)
                console.start(8765)
                console.request("127.0.0.1", "Browser", "GET /missing HTTP/1.1", 404)
                console.request("127.0.0.1", "Browser", "GET /broken HTTP/1.1", 500)
                console.stop()
                output = stream.getvalue()
                for text in ("online", "http://127.0.0.1:8765/", "0 active", "stopped", "Failures"):
                    self.assertIn(text, output)
                self.assertEqual("\033[32m" in output, colored)
                self.assertEqual("\033[2K" in output, tty and env.get("TERM") != "dumb")

    def test_live_total_is_replaced_after_arrivals_errors_and_expiration(self):
        for env in ({}, {"NO_COLOR": ""}):
            with self.subTest(env=env), patch.dict("os.environ", env, clear=True):
                now = [0]
                stream = io.StringIO()
                stream.isatty = lambda: True
                console = self.make_console(stream, clock=lambda: now[0])
                console.start(8765)

                def current_total():
                    # Every refresh replaces the current line without a newline.
                    return stream.getvalue().rsplit("\r\033[2K", 1)[-1].split("\n")[-1]

                self.assertIn("0 active", current_total())
                console.request("127.0.0.1", "Browser A", "GET / HTTP/1.1", 200)
                self.assertIn("1 active", current_total())
                console.request("127.0.0.1", "Browser A", "GET / HTTP/1.1", 200)
                self.assertIn("1 active", current_total())
                console.request("127.0.0.1", "Browser B", "GET / HTTP/1.1", 404)
                self.assertIn("2 active", current_total())
                console.error("Protocol error")
                self.assertIn("2 active", current_total())
                now[0] = 120
                console.expire()
                self.assertIn("0 active", current_total())
                self.assertEqual(stream.getvalue().count("\n"), 5)
                self.assertNotIn("GET /", stream.getvalue())
                self.assertNotIn("New client", stream.getvalue())
                self.assertIn(
                    "Failures 2", current_total().replace("\033[33m", "").replace("\033[0m", "")
                )
                console.stop()
                self.assertTrue(
                    stream.getvalue().endswith("stopped\n")
                    or stream.getvalue().endswith("stopped\033[0m\n")
                )

    def test_identity_refresh_expiration_and_return(self):
        now = [0]
        stream = io.StringIO()
        console = self.make_console(stream, clock=lambda: now[0])
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
        self.assertIn("Clients: 0 active", self.activity.getvalue())
        console.request("127.0.0.1", "Browser A", "GET / HTTP/1.1", 200)
        self.assertEqual(self.activity.getvalue().count("New client"), 4)
        self.assertEqual(self.activity.getvalue().count("Inactive client"), 3)
        self.assertIn("GET /", self.activity.getvalue())
        self.assertEqual(stream.getvalue(), "")

    def test_concurrent_requests_count_one_identity_and_escape_untrusted_text(self):
        stream = io.StringIO()
        console = self.make_console(stream)
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(
                pool.map(
                    lambda _: console.request("127.0.0.1", "A\033[31m\nB", "/", 200), range(50)
                )
            )
        console.error("bad\033[31m\nmessage")
        self.assertEqual(len(console.clients), 1)
        self.assertEqual(self.activity.getvalue().count("New client"), 1)
        self.assertNotIn("\033", self.activity.getvalue())
        self.assertIn(r"\u001b", self.activity.getvalue())
        self.assertEqual(len(self.activity.getvalue().splitlines()), 52)

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
                    logger = logging.Logger("test.http", level=logging.INFO)
                    logger.addHandler(logging.StreamHandler(stream))
                    server.console = ServerConsole(
                        io.StringIO(), logger=logger, clock=lambda: now[0]
                    )
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
                        self.assertIn("GET /api/project", stream.getvalue())
                        icons = []
                        for path in ("/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"):
                            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=2)
                            try:
                                connection.request("GET", path, headers={"User-Agent": "Browser A"})
                                response = connection.getresponse()
                                self.assertEqual(response.status, 200)
                                self.assertEqual(response.getheader("Content-Type"), "image/png")
                                icons.append(response.read())
                            finally:
                                connection.close()
                        self.assertEqual(icons[0], icons[1])
                        self.assertEqual(decode(icons[0])[:2], (256, 256))
                        self.assertIn("apple-touch-icon", stream.getvalue())
                        self.assertEqual(request("/missing"), 404)
                        self.assertEqual(request("/api/create-project", method="POST"), 403)
                        self.assertEqual(request("/", headers={"Host": "evil.example"}), 403)
                        self.assertEqual(server.console.failures, 3)
                        self.assertEqual(request("/", method="DELETE"), 501)
                        self.assertEqual(server.console.failures, 4)
                        self.assertIn("Unsupported method", stream.getvalue())
                        with create_connection(
                            ("127.0.0.1", server.server_port), timeout=2
                        ) as sock:
                            sock.sendall(b"GET / HTTP/1.1 extra\r\n\r\n")
                            # Early parse errors use an HTTP/0.9-style body without
                            # a status line, because no HTTP version was accepted.
                            with sock.makefile("rb") as response:
                                self.assertIn(b"Error code: 400", response.read())
                        self.assertEqual(server.console.failures, 5)
                        self.assertIn("Bad request version", stream.getvalue())
                        for status in (400, 403, 404, 501):
                            self.assertIn(f"HTTP {status}", stream.getvalue())
                        now[0] = 120
                        self.assertTrue(expired.wait(2), "Idle server did not expire clients")
                        self.assertEqual(len(server.console.clients), 0)
                    finally:
                        server.shutdown()
                        thread.join(timeout=2)
