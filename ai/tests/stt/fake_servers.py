"""가짜 HTTPS 서버. 자체 서명 인증서로 띄워 EliceStt 와 GpuSwitch 가 실제 requests·TLS 를 지나게 한다.

openssl 이 없으면 cert_pair 가 건너뛴다. 실제 Elice 와 AWS 는 부르지 않는다.
"""

from __future__ import annotations

import email.parser
import json
import shutil
import ssl
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest


def cert_pair(directory: Path) -> tuple[Path, Path]:
    if not shutil.which("openssl"):
        pytest.skip("openssl 이 있어야 돈다")
    cert, key = directory / "cert.pem", directory / "key.pem"
    if not cert.exists():
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-out",
                        str(cert), "-days", "1", "-subj", "/CN=localhost",
                        "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"],
                       check=True, capture_output=True)
    return cert, key


class FakeHttps:
    """respond(method, path, headers, body) -> (상태, 본문 bytes, content-type) 로 답한다. 받은 요청을 남긴다."""

    def __init__(self, cert: Path, key: Path, respond) -> None:
        self.respond = respond
        self.requests: list[dict] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                outer.requests.append({"path": self.path, "headers": dict(self.headers), "body": body})
                status, payload, ctype = outer.respond("POST", self.path, self.headers, body)
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(str(cert), str(key))
        self.httpd.socket = ctx.wrap_socket(self.httpd.socket, server_side=True)
        self.url = f"https://127.0.0.1:{self.httpd.server_address[1]}"
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self._thread.start()

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


def form_fields(req: dict) -> dict[str, list[str]]:
    """multipart 본문의 파일이 아닌 필드. 같은 이름이 여러 번이면 목록이다."""
    head = f"Content-Type: {req['headers']['Content-Type']}\r\n\r\n".encode()
    msg = email.parser.BytesParser().parsebytes(head + req["body"])
    out: dict[str, list[str]] = {}
    for part in msg.get_payload():
        if part.get_filename():
            continue
        name = part.get_param("name", header="content-disposition")
        out.setdefault(name, []).append(part.get_payload(decode=True).decode())
    return out


class FakeStt(FakeHttps):
    """vLLM 의 /v1/audio/transcriptions 대역. mode 로 응답을 고른다: ok, empty, 503, 401, 400, html, stall."""

    def __init__(self, cert: Path, key: Path, *, text: str = "안녕하세요", stall_s: float = 3.0) -> None:
        self.mode = "ok"
        self.script: list[str] = []      # 앞 요청들의 응답. 다 쓰면 mode 를 따른다
        self.text = text
        self.stall_s = stall_s
        self.lock = threading.Lock()
        super().__init__(cert, key, self._answer)

    def _answer(self, method, path, headers, body):
        with self.lock:
            mode = self.script.pop(0) if self.script else self.mode
        if mode == "stall":
            time.sleep(self.stall_s)
            mode = "ok"
        if mode in ("ok", "empty"):
            text = self.text if mode == "ok" else ""
            return 200, json.dumps({"text": f" {text}", "words": None}).encode(), "application/json"
        if mode == "html":
            return 200, b"<html>gateway</html>", "text/html"
        return int(mode), b'{"error": "fake"}', "application/json"

    def forms(self) -> list[dict[str, list[str]]]:
        return [form_fields(r) for r in list(self.requests)]

    @property
    def calls(self) -> int:
        return len(self.requests)
