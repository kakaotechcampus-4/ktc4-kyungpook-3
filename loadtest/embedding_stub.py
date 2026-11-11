"""OpenAI 호환 POST /embeddings 의 0원 대역. 글자 2-gram 을 1536 칸에 해시해 정규화하므로 비슷한 문장은 비슷한 벡터가 된다."""
import hashlib
import json
import math
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DIMENSIONS = 1536


def embed(text: str) -> list[float]:
    vector = [0.0] * DIMENSIONS
    for i in range(max(len(text) - 1, 1)):
        bucket = int.from_bytes(hashlib.blake2b(text[i:i + 2].encode(), digest_size=4).digest(), "big")
        vector[bucket % DIMENSIONS] += 1.0
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        texts = body["input"] if isinstance(body["input"], list) else [body["input"]]
        payload = json.dumps({
            "object": "list",
            "data": [{"object": "embedding", "index": i, "embedding": embed(t)} for i, t in enumerate(texts)],
            "model": body.get("model"),
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("0.0.0.0", 8100), Handler).serve_forever()
