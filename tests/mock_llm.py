#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mock OpenAI-compatible server for testing English Reader without a real API key.

Run:  python tests/mock_llm.py   ->  http://127.0.0.1:8766/v1
Use in the reader Settings: Base URL = http://127.0.0.1:8766/v1, model = mock-gpt
"""
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PORT = 8766

MOCK_TRANSLATION = "模拟翻译：突然，一只粉红眼睛的白兔从她身边跑过。"
MOCK_EXPLANATION = (
    "This is a **mock explanation** from the local test model.\n\n"
    "- The sentence is from *Alice's Adventures in Wonderland*.\n"
    "- `White Rabbit` here is a proper noun introducing a key character.\n"
    "- Grammatically, the adverbial clause `when suddenly...` sets the scene "
    "for the main action `ran close by her`.\n\n"
    "Replace the Base URL in Settings with a real provider to get genuine answers."
)
MOCK_CHAT = (
    "Mock reply from the local test model. I received your message and this "
    "response is streamed in several chunks so you can verify that token-by-token "
    "rendering works. Point Settings at a real API to chat for real."
)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _json(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _sse_start(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

    def _sse_emit_raw(self, data):
        self.wfile.write(("data: " + data + "\n\n").encode("utf-8"))
        self.wfile.flush()

    def _sse_emit_delta(self, model, chunk):
        self._sse_emit_raw(json.dumps(
            {"id": "mock-1", "model": model,
             "choices": [{"index": 0, "delta": {"content": chunk}}]},
            ensure_ascii=False))

    def do_GET(self):
        if urlparse(self.path).path.endswith("/models"):
            return self._json(200, {"object": "list", "data": [{"id": "mock-gpt"}, {"id": "mock-large"}]})
        return self._json(404, {"error": {"message": "not found"}})

    def do_POST(self):
        if not urlparse(self.path).path.endswith("/chat/completions"):
            return self._json(404, {"error": {"message": "not found"}})
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return self._json(400, {"error": {"message": "bad json"}})

        model = body.get("model", "mock-gpt")
        msgs = body.get("messages") or []
        texts = [m.get("content", "") for m in msgs if m.get("role") == "user"]
        last = texts[-1] if texts else ""
        is_translate = any("translator" in (m.get("content") or "") for m in msgs if m.get("role") == "system")

        # function-calling simulation: ask for web_search first, then "use" the result
        has_tools = bool(body.get("tools"))
        has_tool_result = any(m.get("role") == "tool" for m in msgs)
        if has_tools and not has_tool_result:
            msg = {"role": "assistant", "content": None, "tool_calls": [{
                "id": "call_mock_1", "type": "function",
                "function": {"name": "web_search",
                             "arguments": json.dumps({"query": "lewis carroll white rabbit symbolism"})},
            }]}
            if not body.get("stream"):
                return self._json(200, {"id": "mock-1", "object": "chat.completion", "model": model,
                                        "choices": [{"index": 0, "finish_reason": "tool_calls", "message": msg}]})
            data = json.dumps({"id": "mock-1", "model": model,
                               "choices": [{"index": 0, "finish_reason": "tool_calls",
                                            "delta": {"role": "assistant", "tool_calls": msg["tool_calls"]}}]},
                              ensure_ascii=False)
            self._sse_emit_raw(data)
            return None

        if has_tools and has_tool_result:
            reply = "Search-informed mock answer: the web_search tool returned pages about the topic, and I used them."
        elif "CUSTOM-MARKER" in last:
            reply = "Received prompt: " + last
        elif is_translate:
            reply = MOCK_TRANSLATION
        elif "Passage" in last:
            reply = MOCK_EXPLANATION
        else:
            reply = MOCK_CHAT

        if not body.get("stream"):
            return self._json(200, {
                "id": "mock-1", "object": "chat.completion", "model": model,
                "choices": [{"index": 0, "finish_reason": "stop",
                             "message": {"role": "assistant", "content": reply}}],
            })

        self._sse_start()

        try:
            self._sse_emit_raw(json.dumps({"id": "mock-1", "model": model,
                               "choices": [{"index": 0, "delta": {"role": "assistant"}}]}))
            step = max(1, len(reply) // 8)
            for i in range(0, len(reply), step):
                self._sse_emit_delta(model, reply[i:i + step])
                time.sleep(0.08)
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass


if __name__ == "__main__":
    print("Mock LLM on http://127.0.0.1:%d/v1 (model: mock-gpt)" % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
