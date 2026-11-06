"""Local HTTP server for crawl tests. Binds 127.0.0.1 only; no external network."""

import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit

import pytest

SITE = Path(__file__).parent / "fixtures" / "site"

CONTENT_TYPES = {".html": "text/html; charset=utf-8", ".txt": "text/plain; charset=utf-8"}


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):  # keep test output quiet
        pass

    def _send(self, status, body: bytes, content_type: str, headers: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802 (http.server naming)
        server = self.server
        path = urlsplit(self.path).path
        with server.lock:
            server.hits.append((path, time.monotonic()))

        if path == "/redirect/start":
            return self._send(301, b"", "text/plain", {"Location": "/redirect/middle"})
        if path == "/redirect/middle":
            return self._send(302, b"", "text/plain", {"Location": "/index.html"})
        if path == "/broken":
            return self._send(500, b"server error", "text/plain")
        if path == "/rate-limited-once":
            hits = sum(1 for p, _ in server.hits if p == path)
            if hits == 1:
                return self._send(429, b"slow down", "text/plain", {"Retry-After": "0"})
            return self._send(200, b"<html><head><title>ok</title></head><body><h1>ok</h1></body></html>", "text/html; charset=utf-8")
        if path == "/rate-limited-always":
            return self._send(429, b"slow down", "text/plain", {"Retry-After": "0"})
        if path == "/robots.txt" and server.robots_status != 200:
            return self._send(server.robots_status, b"", "text/plain")
        if path == "/":
            path = "/index.html"

        target = (SITE / path.lstrip("/")).resolve()
        if SITE.resolve() not in target.parents or not target.is_file():
            return self._send(404, b"not found", "text/plain")
        content_type = CONTENT_TYPES.get(target.suffix, "application/octet-stream")
        return self._send(200, target.read_bytes(), content_type)


class LocalSite:
    def __init__(self, server: ThreadingHTTPServer):
        self._server = server
        self.base = f"http://127.0.0.1:{server.server_address[1]}"

    @property
    def hits(self):
        return list(self._server.hits)

    @property
    def robots_status(self):
        return self._server.robots_status

    @robots_status.setter
    def robots_status(self, value: int):
        self._server.robots_status = value

    def url(self, path: str) -> str:
        return self.base + path


@pytest.fixture
def local_site():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    server.hits = []
    server.lock = threading.Lock()
    server.robots_status = 200
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield LocalSite(server)
    finally:
        server.shutdown()
        server.server_close()
