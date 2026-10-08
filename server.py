#!/usr/bin/env python3
"""Daily Tracker server.

Serves the page from ./public and stores one JSON file per month in DATA_DIR.
Standard library only, no packages to install.

  GET  /api/month/YYYY-MM   -> {"exists": true, "data": {...}}
                               or {"exists": false, "tasks": [names from the latest earlier month]}
  PUT  /api/month/YYYY-MM   -> saves the month (JSON object, up to 256 KB)
  GET  /api/version         -> {"version": "..."}  (the page reloads itself when this changes)
  GET  /api/health          -> {"ok": true, "version": "..."}
"""

import hashlib
import json
import os
import re
import signal
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DATA = Path(os.environ.get("DATA_DIR", str(ROOT / "data"))).resolve()
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))
MAX_BODY = 256 * 1024

MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
ROUTE_RE = re.compile(r"^/api/month/(\d{4}-(?:0[1-9]|1[0-2]))$")
write_lock = threading.Lock()


def compute_version() -> str:
    """The build's git commit when built by GitHub Actions, otherwise a hash of the app files."""
    v = os.environ.get("APP_VERSION", "").strip()
    if v and v != "dev":
        return v[:12]
    h = hashlib.sha1()
    for p in sorted(PUBLIC.rglob("*")):
        if p.is_file():
            h.update(p.relative_to(PUBLIC).as_posix().encode())
            h.update(p.read_bytes())
    h.update(Path(__file__).read_bytes())
    return "local-" + h.hexdigest()[:10]


VERSION = compute_version()


def month_file(key: str) -> Path:
    return DATA / f"{key}.json"


def latest_task_names(before: str) -> list:
    """Task names from the most recent saved month before `before`, so a new month starts with the same list."""
    if not DATA.is_dir():
        return []
    earlier = sorted(p.stem for p in DATA.glob("*.json") if MONTH_RE.match(p.stem) and p.stem < before)
    for key in reversed(earlier):
        try:
            saved = json.loads(month_file(key).read_text(encoding="utf-8"))
            tasks = saved.get("tasks", []) if isinstance(saved, dict) else []
            names = [t.get("name", "") for t in tasks if isinstance(t, dict) and isinstance(t.get("name", ""), str)]
            if any(n.strip() for n in names):
                return names
        except (OSError, ValueError):
            continue
    return []


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".js": "text/javascript",
        ".svg": "image/svg+xml",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def log_request(self, code="-", size="-"):
        # Only log failed requests, keep the container log quiet
        try:
            if int(code) >= 400:
                super().log_request(code, size)
        except (TypeError, ValueError):
            pass

    def end_headers(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/") or path in ("/", "/index.html", "/app.js", "/app.css"):
            # Always fetch fresh so updates to the files show up on the tablet
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            return self._json(200, {"ok": True, "version": VERSION})
        if path == "/api/version":
            return self._json(200, {"version": VERSION})
        m = ROUTE_RE.match(path)
        if m:
            key = m.group(1)
            f = month_file(key)
            if f.is_file():
                try:
                    return self._json(200, {"exists": True, "data": json.loads(f.read_text(encoding="utf-8"))})
                except (OSError, ValueError):
                    return self._json(500, {"error": "could not read saved month"})
            return self._json(200, {"exists": False, "tasks": latest_task_names(key)})
        if path.startswith("/api/"):
            return self._json(404, {"error": "not found"})
        return super().do_GET()

    def do_HEAD(self):
        if self.path.startswith("/api/"):
            return self._json(405, {"error": "method not allowed"})
        return super().do_HEAD()

    def do_PUT(self):
        m = ROUTE_RE.match(self.path.split("?", 1)[0])
        if not m:
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return self._json(413, {"error": "body missing or too large"})
        try:
            obj = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self._json(400, {"error": "invalid JSON"})
        if not isinstance(obj, dict):
            return self._json(400, {"error": "expected a JSON object"})

        with write_lock:
            DATA.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=str(DATA), suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    json.dump(obj, fh, ensure_ascii=False, indent=1)
                    fh.flush()
                    os.fsync(fh.fileno())
                os.replace(tmp, month_file(m.group(1)))
            except OSError:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                return self._json(500, {"error": "could not save"})
        return self._json(200, {"ok": True})

    def do_POST(self):
        self._json(405, {"error": "method not allowed"})

    do_DELETE = do_POST


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True

    # Stop promptly when Docker or the updater asks (as PID 1, Python ignores SIGTERM otherwise)
    def stop(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)

    print(f"Daily Tracker {VERSION} on http://{HOST}:{PORT}  (data in {DATA})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        # Wait for any save in progress, then close
        with write_lock:
            server.server_close()
        print("Stopped", flush=True)


if __name__ == "__main__":
    main()
