#!/usr/bin/env python3
"""Daily Tracker server.

Serves the page from ./public and stores one JSON file per month in DATA_DIR.
Standard library only, no packages to install.

It also keeps itself up to date: shortly after starting, and again every
night, it asks GitHub for the latest commit. If there is a new one it
downloads it, checks it, swaps in the new server.py and public/ folder,
and restarts itself. The data folder is never touched.

  GET  /api/month/YYYY-MM   -> {"exists": true, "data": {...}}
                               or {"exists": false, "tasks": [names from the latest earlier month]}
  PUT  /api/month/YYYY-MM   -> saves the month (JSON object, up to 256 KB)
  GET  /api/version         -> {"version": "...", "update": {...}}  (the page reloads when version changes)
  GET  /api/health          -> {"ok": true, "version": "..."}

Settings (environment variables, all optional):
  PORT           port to listen on (8080)
  DATA_DIR       where month files are saved (./data)
  AUTO_UPDATE    set to 0 to turn self-updating off (on by default, off in a git checkout)
  UPDATE_REPO    GitHub repo to update from (JRhattigan1/Daily-Tracker)
  UPDATE_REF     branch, tag or commit to follow (main). Set a commit to pin a version.
  UPDATE_HOUR    hour of the nightly check, container local time (3)
  GITHUB_TOKEN   only needed if the repo is private (a read-only token)
"""

import datetime
import hashlib
import json
import os
import py_compile
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DATA = Path(os.environ.get("DATA_DIR", str(ROOT / "data"))).resolve()
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))
MAX_BODY = 256 * 1024

UPDATE_REPO = os.environ.get("UPDATE_REPO", "JRhattigan1/Daily-Tracker").strip()
UPDATE_REF = os.environ.get("UPDATE_REF", "main").strip() or "main"
UPDATE_HOUR = int(os.environ.get("UPDATE_HOUR", "3")) % 24
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()
GITHUB_API = os.environ.get("GITHUB_API", "https://api.github.com").rstrip("/")
_auto = os.environ.get("AUTO_UPDATE", "").strip().lower()
# Never overwrite a git working copy (that's a development checkout) unless explicitly asked
AUTO_UPDATE = _auto in ("1", "true", "yes", "on") or (_auto == "" and not (ROOT / ".git").exists())
VERSION_FILE = ROOT / ".version"
REQUIRED_FILES = ("server.py", "public/index.html", "public/app.js", "public/app.css")

MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
ROUTE_RE = re.compile(r"^/api/month/(\d{4}-(?:0[1-9]|1[0-2]))$")
write_lock = threading.Lock()
restart_requested = threading.Event()
update_state = {"enabled": AUTO_UPDATE, "repo": UPDATE_REPO, "ref": UPDATE_REF, "last_check": None, "status": "not checked yet"}


def log(msg: str) -> None:
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


def installed_commit() -> str:
    try:
        return VERSION_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def compute_version() -> str:
    """The installed GitHub commit, or a hash of the app files if it wasn't installed by the updater."""
    sha = installed_commit()
    if sha:
        return sha[:7]
    h = hashlib.sha1()
    for p in sorted(PUBLIC.rglob("*")):
        if p.is_file():
            h.update(p.relative_to(PUBLIC).as_posix().encode())
            h.update(p.read_bytes())
    h.update(Path(__file__).read_bytes())
    return "local-" + h.hexdigest()[:10]


VERSION = compute_version()


# ---------- self-update ----------

def github(url: str):
    req = urllib.request.Request(url, headers={
        "User-Agent": "daily-tracker-updater",
        "Accept": "application/vnd.github+json",
    })
    if GITHUB_TOKEN:
        req.add_header("Authorization", f"Bearer {GITHUB_TOKEN}")
    return urllib.request.urlopen(req, timeout=60)


def latest_commit() -> str:
    url = f"{GITHUB_API}/repos/{UPDATE_REPO}/commits/{urllib.parse.quote(UPDATE_REF, safe='')}"
    with github(url) as res:
        sha = json.load(res).get("sha", "")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("GitHub did not return a commit")
    return sha


def install_commit(sha: str) -> None:
    """Download a commit, check it, then swap it in. Raises if anything is wrong, leaving the current version in place."""
    with tempfile.TemporaryDirectory(prefix=".update-", dir=str(ROOT)) as tmp:
        tmp = Path(tmp)
        archive = tmp / "src.tar.gz"
        with github(f"{GITHUB_API}/repos/{UPDATE_REPO}/tarball/{sha}") as res, archive.open("wb") as fh:
            shutil.copyfileobj(res, fh)

        out = tmp / "src"
        out.mkdir()
        with tarfile.open(archive) as tf:
            try:
                tf.extractall(out, filter="data")
            except TypeError:  # Python older than 3.12: check paths ourselves
                for m in tf.getmembers():
                    target = (out / m.name).resolve()
                    if not str(target).startswith(str(out.resolve())) or m.issym() or m.islnk():
                        raise RuntimeError(f"unsafe path in archive: {m.name}")
                tf.extractall(out)
        tops = [p for p in out.iterdir() if p.is_dir()]
        if len(tops) != 1:
            raise RuntimeError("unexpected archive layout")
        src = tops[0]

        missing = [f for f in REQUIRED_FILES if not (src / f).is_file()]
        if missing:
            raise RuntimeError(f"new version is missing {', '.join(missing)}")

        # Check the new server compiles and loads, without starting it
        py_compile.compile(str(src / "server.py"), doraise=True)
        check = subprocess.run(
            [sys.executable, "-c", "import runpy, sys; runpy.run_path(sys.argv[1], run_name='update_check')", str(src / "server.py")],
            cwd=str(src),
            env={**os.environ, "AUTO_UPDATE": "0", "DATA_DIR": str(tmp / "check-data")},
            capture_output=True,
            text=True,
            timeout=60,
        )
        if check.returncode != 0:
            raise RuntimeError("new version failed to load: " + (check.stderr.strip().splitlines() or ["unknown error"])[-1])

        # Stage the new files, then swap them in while no save is in progress
        staged = ROOT / ".public.new"
        old = ROOT / ".public.old"
        shutil.rmtree(staged, ignore_errors=True)
        shutil.rmtree(old, ignore_errors=True)
        shutil.copytree(src / "public", staged)
        shutil.copy2(src / "server.py", ROOT / ".server.py.new")

        with write_lock:
            swap_in(staged, old, sha)


def swap_in(staged: Path, old: Path, sha: str) -> None:
    # Keep the current version as a backup in .previous
    backup = ROOT / ".previous"
    shutil.rmtree(backup, ignore_errors=True)
    backup.mkdir()
    if (ROOT / "server.py").is_file():
        shutil.copy2(ROOT / "server.py", backup / "server.py")
    if PUBLIC.is_dir():
        shutil.copytree(PUBLIC, backup / "public")
    if VERSION_FILE.is_file():
        shutil.copy2(VERSION_FILE, backup / ".version")

    if PUBLIC.exists():
        os.replace(PUBLIC, old)
    os.replace(staged, PUBLIC)
    os.replace(ROOT / ".server.py.new", ROOT / "server.py")
    VERSION_FILE.write_text(sha + "\n", encoding="utf-8")
    shutil.rmtree(old, ignore_errors=True)


def check_for_update(server) -> None:
    update_state["last_check"] = time.strftime("%Y-%m-%d %H:%M:%S")
    try:
        remote = latest_commit()
    except Exception as e:  # network down, GitHub unreachable, repo private without a token
        update_state["status"] = f"could not check GitHub: {e}"
        log(f"Update check failed: {e}")
        return
    if remote == installed_commit():
        update_state["status"] = "up to date"
        log(f"Up to date ({remote[:7]})")
        return
    log(f"New version {remote[:7]} found, installing")
    try:
        install_commit(remote)
    except Exception as e:
        update_state["status"] = f"update to {remote[:7]} failed, kept current version: {e}"
        log(f"Update failed, kept current version: {e}")
        return
    update_state["status"] = f"updated to {remote[:7]}, restarting"
    log(f"Installed {remote[:7]}, restarting")
    restart_requested.set()
    server.shutdown()


def updater_loop(server) -> None:
    time.sleep(float(os.environ.get("UPDATE_START_DELAY", "20")))  # let the server settle first
    check_for_update(server)
    while not restart_requested.is_set():
        now = datetime.datetime.now()
        nxt = now.replace(hour=UPDATE_HOUR, minute=7, second=0, microsecond=0)
        if nxt <= now:
            nxt += datetime.timedelta(days=1)
        time.sleep(max(60.0, (nxt - now).total_seconds()))
        check_for_update(server)


# ---------- data ----------

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


# ---------- web ----------

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
            # Always fetch fresh so updates show up on the tablet
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
            return self._json(200, {"version": VERSION, "update": update_state})
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
    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True

    # Stop promptly when Docker asks (as PID 1, Python ignores SIGTERM otherwise)
    def stop(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)

    log(f"Daily Tracker {VERSION} on http://{HOST}:{PORT}  (data in {DATA})")
    if AUTO_UPDATE:
        log(f"Self-update on: following {UPDATE_REPO}@{UPDATE_REF}, nightly check at {UPDATE_HOUR:02d}:07")
        threading.Thread(target=updater_loop, args=(server,), daemon=True).start()
    else:
        log("Self-update off")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        with write_lock:  # wait for any save in progress
            server.server_close()

    if restart_requested.is_set():
        # Replace this process with the newly installed server
        os.execv(sys.executable, [sys.executable, str(ROOT / "server.py")])
    log("Stopped")


if __name__ == "__main__":
    main()
