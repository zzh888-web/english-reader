#!/usr/bin/env python3
"""English Reader - local server.

Serves the reader UI and proxies LLM API calls (OpenAI-compatible
/chat/completions and /models) so any provider works without CORS issues.

Run:  python server.py
Then: the browser opens http://127.0.0.1:8765 automatically.
"""

import json
import os
import re
import socket
import sys
import time
import webbrowser
import socketserver
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
DEFAULT_PORT = 8765
UPSTREAM_TIMEOUT = 600  # seconds; generous for slow reasoning models
TAVILY_KEY_FILE = os.path.expanduser("~/.tavily/config.json")
BING_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
           "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
SEARCH_CACHE = {}  # query-lower -> (timestamp, payload)

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
}


def _strip_tags(html):
    text = re.sub(r"<[^>]+>", " ", html)
    for a, b in (("&amp;", "&"), ("&#39;", "'"), ("&quot;", '"'),
                 ("&lt;", "<"), ("&gt;", ">"), ("&nbsp;", " ")):
        text = text.replace(a, b)
    return re.sub(r"\s+", " ", text).strip()


def _tavily_key(override=None):
    if override:
        return override
    k = os.environ.get("TAVILY_API_KEY")
    if k:
        return k
    try:
        with open(TAVILY_KEY_FILE, encoding="utf-8") as f:
            v = json.load(f).get("api_key")
            if v:
                return v
    except Exception:
        pass
    return None


def _tavily_search(query, key):
    body = json.dumps({"query": query, "max_results": 5}).encode("utf-8")
    req = urllib.request.Request(
        "https://api.tavily.com/search", data=body, method="POST",
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
    with urllib.request.urlopen(req, timeout=20) as r:
        j = json.loads(r.read().decode("utf-8"))
    return [{"title": it.get("title", ""), "url": it.get("url", ""),
             "content": (it.get("content") or "")[:400]} for it in j.get("results", [])]


def _bing_search(query):
    url = "https://www.bing.com/search?q=" + urllib.parse.quote(query) + "&count=8&mkt=en-US"
    req = urllib.request.Request(url, headers={"User-Agent": BING_UA,
                                               "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=15) as r:
        html = r.read().decode("utf-8", "replace")
    results = []
    for block in re.split(r'<li class="b_algo', html)[1:6]:
        m = re.search(r'<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        if not m:
            continue
        title = _strip_tags(m.group(2))
        sn = (re.search(r'<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>(.*?)</p>', block, re.S)
              or re.search(r'<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>.*?<p[^>]*>(.*?)</p>', block, re.S))
        snippet = _strip_tags(sn.group(1)) if sn else ""
        if title:
            results.append({"title": title, "url": m.group(1), "content": snippet[:400]})
    return results


def web_search(query, tavily_key=None):
    """Tavily first (if a key exists on this machine), Bing HTML as fallback."""
    cached = SEARCH_CACHE.get(query.lower())
    if cached and time.time() - cached[0] < 600:
        return cached[1]
    errors = []
    payload = None
    key = _tavily_key(tavily_key)
    if key:
        try:
            res = _tavily_search(query, key)
            if res:
                payload = {"provider": "tavily", "results": res}
        except Exception as e:
            errors.append("tavily: %s" % e)
    if payload is None:
        try:
            res = _bing_search(query)
            if res:
                payload = {"provider": "bing", "results": res}
        except Exception as e:
            errors.append("bing: %s" % e)
    if payload is None:
        return None, "; ".join(errors) or "no results"
    SEARCH_CACHE[query.lower()] = (time.time(), payload)
    return payload, None


class Handler(BaseHTTPRequestHandler):
    server_version = "EnglishReader/1.0"
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------ helpers
    def log_message(self, fmt, *args):
        sys.stderr.write("[reader] %s\n" % (fmt % args))

    def _send_bytes(self, status, body, ctype, extra_headers=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status, obj):
        self._send_bytes(status, json.dumps(obj).encode("utf-8"),
                         "application/json; charset=utf-8")

    def _read_json_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        if not raw:
            raise ValueError("empty request body")
        return json.loads(raw.decode("utf-8"))

    # ------------------------------------------------------------ GET
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/models":
            return self._proxy_models(parsed)
        if path == "/api/search-config":
            return self._send_json(200, {"tavily": bool(_tavily_key())})
        if path == "/favicon.ico":
            return self._send_bytes(204, b"", "image/x-icon")
        return self._serve_static(path)

    # ------------------------------------------------------------ POST
    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/search":
            return self._do_search()
        if path != "/api/chat":
            return self._send_json(404, {"error": {"message": "not found"}})
        try:
            payload = self._read_json_body()
        except Exception as e:
            return self._send_json(400, {"error": {"message": "bad request: %s" % e}})

        base = str(payload.get("baseUrl") or "").rstrip("/")
        if not base.startswith(("http://", "https://")):
            return self._send_json(400, {"error": {"message": "invalid baseUrl"}})

        endpoint = base + "/chat/completions"
        body = {k: payload[k] for k in
                ("model", "messages", "temperature", "stream", "max_tokens", "tools")
                if payload.get(k) is not None}
        data = json.dumps(body).encode("utf-8")

        headers = {"Content-Type": "application/json",
                   "User-Agent": "english-reader/1.0"}
        if payload.get("apiKey"):
            headers["Authorization"] = "Bearer " + payload["apiKey"]
        if payload.get("stream"):
            headers["Accept"] = "text/event-stream"

        # Some models only accept a fixed temperature (e.g. Kimi thinking series);
        # if the provider rejects ours, transparently retry once without it.
        attempts = [body]
        if "temperature" in body:
            attempts.append({k: v for k, v in body.items() if k != "temperature"})

        resp = None
        for i, attempt in enumerate(attempts):
            req = urllib.request.Request(endpoint, data=json.dumps(attempt).encode("utf-8"),
                                         headers=headers, method="POST")
            try:
                resp = urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT)
                break
            except urllib.error.HTTPError as e:
                raw = e.read()
                if (i == 0 and len(attempts) > 1 and e.code in (400, 422)
                        and "temperature" in raw.decode("utf-8", "replace").lower()):
                    continue  # retry without temperature
                detail = raw
                try:  # try to keep provider's JSON error body
                    detail = json.dumps(json.loads(detail.decode("utf-8"))).encode("utf-8")
                except Exception:
                    detail = json.dumps(
                        {"error": {"message": detail.decode("utf-8", "replace")[:2000]}}
                    ).encode("utf-8")
                return self._send_bytes(e.code, detail, "application/json; charset=utf-8")
            except Exception as e:
                return self._send_json(502, {"error": {"message": "cannot reach %s: %s" % (endpoint, e)}})
        if resp is None:
            return self._send_json(502, {"error": {"message": "no response from upstream"}})

        with resp:
            if payload.get("stream"):
                return self._relay_sse(resp)
            raw = resp.read()
            return self._send_bytes(200, raw,
                                    resp.headers.get("Content-Type", "application/json"))

    # ------------------------------------------------------------ search
    def _do_search(self):
        try:
            body = self._read_json_body()
        except Exception as e:
            return self._send_json(400, {"error": {"message": "bad request: %s" % e}})
        query = str(body.get("query") or "").strip()
        if not query:
            return self._send_json(400, {"error": {"message": "missing query"}})
        payload, err = web_search(query[:400], body.get("tavilyKey") or None)
        if payload is None:
            return self._send_json(502, {"error": {"message": "search failed: %s" % err}})
        return self._send_json(200, payload)

    # ------------------------------------------------------------ SSE relay
    def _relay_sse(self, resp):
        """Pass upstream SSE bytes through line by line so the browser sees
        tokens as they arrive."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            for line in resp:
                if not line:
                    break
                self.wfile.write(line)
                self.wfile.flush()
        except OSError:
            pass  # browser cancelled / closed the page mid-stream (WinError 10053 etc.)
        return None

    # ------------------------------------------------------------ models
    def _proxy_models(self, parsed):
        q = parse_qs(parsed.query)
        base = (q.get("baseUrl") or [""])[0].rstrip("/")
        if not base.startswith(("http://", "https://")):
            return self._send_json(400, {"error": {"message": "invalid baseUrl"}})
        headers = {"User-Agent": "english-reader/1.0"}
        key = (q.get("apiKey") or [""])[0]
        if key:
            headers["Authorization"] = "Bearer " + key
        req = urllib.request.Request(base + "/models", headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return self._send_bytes(200, resp.read(),
                                        resp.headers.get("Content-Type", "application/json"))
        except urllib.error.HTTPError as e:
            return self._send_bytes(e.code, e.read(), "application/json; charset=utf-8")
        except Exception as e:
            return self._send_json(502, {"error": {"message": str(e)}})

    # ------------------------------------------------------------ static
    def _serve_static(self, path):
        if path in ("/", "/index.html"):
            path = "/index.html"
        fname = os.path.normpath(os.path.join(STATIC, path.lstrip("/")))
        if not fname.startswith(STATIC) or not os.path.isfile(fname):
            return self._send_json(404, {"error": {"message": "not found: " + path}})
        with open(fname, "rb") as f:
            raw = f.read()
        ext = os.path.splitext(fname)[1].lower()
        self._send_bytes(200, raw, MIME.get(ext, "application/octet-stream"))


class Server(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True
    # HTTPServer sets allow_reuse_address=1, which on Windows lets several
    # instances bind the same port simultaneously and hijack each other's
    # connections. Bind exclusively instead so a second instance fails loudly.
    allow_reuse_address = False

    def server_bind(self):
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    port = DEFAULT_PORT
    if "--port" in sys.argv:
        try:
            port = int(sys.argv[sys.argv.index("--port") + 1])
        except Exception:
            pass
    try:
        srv = Server(("127.0.0.1", port), Handler)
    except OSError:
        print("=" * 60)
        print(" Port %d is already in use." % port)
        print(" Another English Reader console window is probably still")
        print(" running - close that window first, then start again.")
        print(" Books, translations and API settings are saved per port")
        print(" address, so always stick to the same port when possible.")
        print("=" * 60)
        sys.exit(1)

    url = "http://127.0.0.1:%d" % port
    print("=" * 52)
    print(" English Reader is running.")
    print(" Open:  %s" % url)
    print(" Stop:  press Ctrl+C (or close this window).")
    print("=" * 52)
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nBye.")
        srv.server_close()


if __name__ == "__main__":
    main()
