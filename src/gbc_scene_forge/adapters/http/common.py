"""Loopback response and Host checks shared by HTTP frontends."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from socketserver import TCPServer

from gbc_scene_forge.core.serialization import json_text

STATIC = files("gbc_scene_forge").joinpath("static")


class LocalHTTPServer(ThreadingHTTPServer):
    def server_bind(self):
        # HTTPServer reverse-resolves the bound address to populate server_name.
        # Our numeric loopback URL needs no DNS, which can stall offline/CI hosts.
        TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


class LocalHandler(BaseHTTPRequestHandler):
    def reply(self, body, content_type="application/json", status=200, filename=None):
        if not isinstance(body, bytes):
            body = json_text(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        )
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(body)

    def trusted_host(self):
        return self.headers.get("Host") in (
            f"127.0.0.1:{self.server.server_port}",
            f"localhost:{self.server.server_port}",
        )
