import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOME = Path.home()
APP_DIR = HOME / "Library" / "Application Support" / "Damla"
SETTINGS_FILE = APP_DIR / "settings.json"
HISTORY_FILE = APP_DIR / "history.json"
ORIGIN_PREFIX = "safari-web-extension://"
HOSTS = ("127.0.0.1:8791", "localhost:8791")
GITHUB_REPO = "kaanrkaraman/damla"
YTDLP_REPO = "yt-dlp/yt-dlp"
CHECK_EVERY = 6 * 3600
RES = Path(__file__).resolve().parent
ROOT = RES.parent
BUNDLE_BIN = ROOT / "bin"
USER_BIN = APP_DIR / "bin"
CA_FILE = "/etc/ssl/cert.pem"
KEEP_FINISHED = 50
GENERIC_TITLES = {""}
FINISHED = ("done", "error", "cancelled")
ACTIVE = ("queued", "running")

DEFAULTS = {
    "folder": str(HOME / "Downloads" / "Damla"),
    "quality": "best",
    "codec": "compat",
    "concurrent": 2,
    "by_site": False,
    "cookies": False,
    "reveal": False,
}
QUALITY = {"best": None, "1080": 1080, "720": 720, "audio": None}

ENV = {**os.environ, "PATH": ":".join([str(USER_BIN), str(BUNDLE_BIN), "/opt/homebrew/bin", "/usr/local/bin", os.environ.get("PATH", "")])}


def resolve_ytdlp():
    for zipapp in (USER_BIN / "yt-dlp", BUNDLE_BIN / "yt-dlp"):
        if zipapp.is_file():
            return [sys.executable, str(zipapp)]
    return [shutil.which("yt-dlp", path=ENV["PATH"]) or "yt-dlp"]


YTDLP_CMD = resolve_ytdlp()
SSL_CTX = ssl.create_default_context(cafile=CA_FILE if Path(CA_FILE).exists() else None)

LOCK = threading.Lock()
JOBS: list[dict] = []
SEQ = 0


def load_json(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def save_json(path, data):
    APP_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False))
    tmp.replace(path)


def clean_settings(raw, base):
    out = dict(base)
    folder = raw.get("folder")
    if isinstance(folder, str):
        p = Path(os.path.normpath(Path(folder).expanduser()))
        if p.is_absolute() and (p.is_relative_to(HOME) or p.is_relative_to("/Volumes")):
            out["folder"] = str(p)
    if raw.get("quality") in QUALITY:
        out["quality"] = raw["quality"]
    if raw.get("concurrent") in (1, 2, 3, 4):
        out["concurrent"] = raw["concurrent"]
    if raw.get("codec") in ("compat", "quality"):
        out["codec"] = raw["codec"]
    elif isinstance(raw.get("compat"), bool):
        out["codec"] = "compat" if raw["compat"] else "quality"
    for key in ("by_site", "cookies", "reveal"):
        if isinstance(raw.get(key), bool):
            out[key] = raw[key]
    return out


SETTINGS = clean_settings(load_json(SETTINGS_FILE, {}), DEFAULTS)
JOBS.extend(j for j in load_json(HISTORY_FILE, []) if j.get("state") in FINISHED)


def public(job):
    return {k: v for k, v in job.items() if k not in ("proc", "seq")}


def settings_view():
    return {**SETTINGS, "folder_label": SETTINGS["folder"].replace(str(HOME), "~", 1)}


def ytdlp_version():
    try:
        return subprocess.run([*YTDLP_CMD, "--version"], capture_output=True, text=True, env=ENV).stdout.strip()
    except OSError:
        return ""


def read_app_version():
    for path in (RES / "VERSION", ROOT / "VERSION"):
        try:
            return path.read_text().strip()
        except OSError:
            continue
    return "0.0.0"


APP_VERSION = read_app_version()
TOOL = {"ytdlp": None}
UPDATES = {"checked": 0.0, "checking": False, "app": None, "ytdlp": None}


def parse_version(v):
    return tuple(int(x) for x in re.findall(r"\d+", v or ""))


def latest_release(repo):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/releases/latest",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "damla"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8, context=SSL_CTX) as r:
            data = json.load(r)
        return {"version": data["tag_name"].lstrip("v"), "url": data["html_url"]}
    except (OSError, ValueError, KeyError):
        return None


def check_updates():
    with LOCK:
        if UPDATES["checking"] or time.time() - UPDATES["checked"] < CHECK_EVERY:
            return
        UPDATES["checking"] = True
    app, ytdlp = latest_release(GITHUB_REPO), latest_release(YTDLP_REPO)
    with LOCK:
        UPDATES.update(app=app, ytdlp=ytdlp, checking=False, checked=time.time() if (app or ytdlp) else 0.0)


def about():
    threading.Thread(target=check_updates, daemon=True).start()
    with LOCK:
        app, ytdlp = UPDATES["app"], UPDATES["ytdlp"]
        return {
            "helper": APP_VERSION,
            "ytdlp": TOOL["ytdlp"],
            "latest_app": app,
            "latest_ytdlp": ytdlp,
            "app_update": bool(app) and parse_version(app["version"]) > parse_version(APP_VERSION),
            "ytdlp_update": bool(ytdlp) and parse_version(ytdlp["version"]) > parse_version(TOOL["ytdlp"]),
            "checking": UPDATES["checking"],
            "bundled": ".app/Contents/" in str(RES),
        }


def download_ytdlp():
    USER_BIN.mkdir(parents=True, exist_ok=True)
    target, part = USER_BIN / "yt-dlp", USER_BIN / "yt-dlp.part"
    url = f"https://github.com/{YTDLP_REPO}/releases/latest/download/yt-dlp"
    with urllib.request.urlopen(url, timeout=60, context=SSL_CTX) as r, open(part, "wb") as f:
        shutil.copyfileobj(r, f)
    check = subprocess.run([sys.executable, str(part), "--version"], capture_output=True, text=True, timeout=60)
    if check.returncode != 0 or not check.stdout.strip():
        part.unlink(missing_ok=True)
        raise OSError("indirilen yt-dlp çalışmadı")
    part.replace(target)
    target.chmod(0o755)
    return [sys.executable, str(target)]


def update_ytdlp():
    global YTDLP_CMD
    real = str(Path(YTDLP_CMD[0]).resolve())
    try:
        if len(YTDLP_CMD) == 1 and ("/Cellar/" in real or real.startswith("/opt/homebrew")):
            r = subprocess.run(["brew", "upgrade", "yt-dlp"], capture_output=True, text=True, env=ENV, timeout=300)
            ok, tail = r.returncode == 0, (r.stderr or r.stdout).strip().splitlines()[-1:]
            msg = tail[0][:200] if tail else ""
        else:
            YTDLP_CMD, ok, msg = download_ytdlp(), True, ""
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "msg": str(e)[:200]}
    TOOL["ytdlp"] = ytdlp_version()
    with LOCK:
        UPDATES["checked"] = 0.0
    threading.Thread(target=check_updates, daemon=True).start()
    return {"ok": ok, "version": TOOL["ytdlp"], "msg": msg}


def load_ytdlp_version():
    TOOL["ytdlp"] = ytdlp_version()


threading.Thread(target=load_ytdlp_version, daemon=True).start()
threading.Thread(target=check_updates, daemon=True).start()


def command(job, s):
    cmd = [
        *YTDLP_CMD, "--no-playlist", "--no-warnings", "-q", "--progress", "--newline",
        "--progress-template", "download:@@%(progress.downloaded_bytes)s/%(progress.total_bytes)s/%(progress.total_bytes_estimate)s/%(progress.fragment_index)s/%(progress.fragment_count)s",
        "-o", "%(title).80B [%(id)s].%(ext)s",
        "--print", "after_move:filepath",
    ]
    quality = s["quality"]
    compat = s["codec"] == "compat"
    if quality == "audio":
        cmd += ["-x", "--audio-format", "m4a" if compat else "best"]
    else:
        res = "res" if quality == "best" else f"res:{QUALITY[quality]}"
        cmd += ["-S", f"vcodec:h264,{res},acodec:aac" if compat else res]
        if compat:
            cmd += ["--merge-output-format", "mp4"]
    if s["cookies"]:
        cmd += ["--cookies-from-browser", "safari"]
    folder = Path(s["folder"])
    if s["by_site"]:
        folder /= (urlparse(job["url"]).hostname or "diger").removeprefix("www.")
    return [*cmd, "-P", str(folder), "--", job["url"]]


def video_codec(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", path], capture_output=True, text=True, env=ENV)
    m = re.search(r"Video: (\w+)", r.stderr)
    return m.group(1) if m else ""


def h264_encoder():
    out = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True, env=ENV).stdout
    if " libx264 " in out:
        return ["-c:v", "libx264", "-crf", "20", "-preset", "veryfast"]
    return ["-c:v", "h264_videotoolbox", "-b:v", "10M"]


def ensure_quicktime(job, path):
    if video_codec(path) in ("h264", "hevc", ""):
        return path
    with LOCK:
        job["msg"] = "@converting"
    final = Path(path).with_suffix(".mp4")
    tmp = final.with_name(final.stem + ".converting.mp4")
    r = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", path, *h264_encoder(),
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", str(tmp)],
        capture_output=True, env=ENV,
    )
    with LOCK:
        job["msg"] = ""
    if r.returncode != 0:
        tmp.unlink(missing_ok=True)
        return path
    if str(final) != path:
        Path(path).unlink(missing_ok=True)
    tmp.replace(final)
    return str(final)


def run(job, s):
    path, code, err = "", 1, []
    try:
        proc = subprocess.Popen(command(job, s), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=ENV)
    except OSError:
        err = ["@missing"]
    else:
        with LOCK:
            job["proc"] = proc
        for line in proc.stdout:
            line = line.strip()
            if line.startswith("@@"):
                done, total, est, frag, frags = (line[2:].split("/") + [""] * 5)[:5]
                size = next((int(x) for x in (total, est) if x.isdigit() and int(x) > 0), 0)
                if done.isdigit() and size:
                    pct = int(done) * 100 / size
                elif frag.isdigit() and frags.isdigit() and int(frags) > 0:
                    pct = int(frag) * 100 / int(frags)
                else:
                    continue
                with LOCK:
                    job["percent"] = max(job["percent"], min(99, int(pct)))
            elif line:
                path = line
        err = proc.stderr.read().strip().splitlines()
        code = proc.wait()
        if code == 0 and path and s["codec"] == "compat" and s["quality"] != "audio":
            path = ensure_quicktime(job, path)
    with LOCK:
        job.pop("proc", None)
        if job["state"] != "cancelled":
            ok = code == 0 and bool(path)
            job["state"] = "done" if ok else "error"
            job["percent"] = 100 if ok else job["percent"]
            job["path"] = path if ok else ""
            job["file"] = Path(path).name if ok else ""
            if ok and job["title"] in GENERIC_TITLES:
                job["title"] = re.sub(r"\s*\[[^\]]+\]$", "", Path(path).stem)
            job["msg"] = "" if ok else (err[-1] if err else "@failed").removeprefix("ERROR: ")[:300]
        job["finished"] = time.time()
        finished_ok = job["state"] == "done"
        trim()
        save_json(HISTORY_FILE, [public(j) for j in JOBS if j["state"] in FINISHED])
    if finished_ok and s["reveal"]:
        subprocess.run(["open", "-R", job["path"]])
    pump()


def trim():
    finished, keep = 0, []
    for j in JOBS:
        if j["state"] in ACTIVE:
            keep.append(j)
        else:
            finished += 1
            if finished <= KEEP_FINISHED:
                keep.append(j)
    JOBS[:] = keep


def pump():
    with LOCK:
        running = sum(j["state"] == "running" for j in JOBS)
        for j in sorted((j for j in JOBS if j["state"] == "queued"), key=lambda j: j["seq"]):
            if running >= SETTINGS["concurrent"]:
                break
            j["state"] = "running"
            running += 1
            threading.Thread(target=run, args=(j, dict(SETTINGS)), daemon=True).start()


def enqueue(items):
    global SEQ
    out, fresh = [], []
    with LOCK:
        for it in items:
            url = it.get("url", "")
            if urlparse(url).scheme not in ("http", "https"):
                continue
            existing = next((j for j in JOBS if j["url"] == url and j["state"] in ACTIVE), None)
            if existing:
                out.append(existing)
                continue
            SEQ += 1
            thumb = str(it.get("thumb", ""))
            job = {
                "id": uuid.uuid4().hex[:8], "seq": SEQ, "url": url,
                "title": str(it.get("title", ""))[:200],
                "thumb": thumb if thumb.startswith(("http://", "https://")) else "",
                "state": "queued", "percent": 0, "file": "", "path": "", "msg": "", "finished": 0,
            }
            fresh.append(job)
            out.append(job)
        JOBS[0:0] = fresh
        trim()
        result = [public(j) for j in out]
    pump()
    return result


def find(job_id):
    return next((j for j in JOBS if j["id"] == job_id), None)


def cancel(job_id):
    with LOCK:
        job = find(job_id)
        if not job or job["state"] not in ACTIVE:
            return False
        job["state"], job["finished"] = "cancelled", time.time()
        proc = job.get("proc")
    if proc:
        proc.terminate()
    return True


def reveal(job_id):
    with LOCK:
        job = find(job_id)
        path = job["path"] if job else ""
    if not path or not Path(path).exists():
        return False
    subprocess.run(["open", "-R", path])
    return True


def update_app():
    app = RES.parent.parent.parent
    if app.suffix != ".app":
        return False
    r = subprocess.run(["open", "-g", "-a", str(app), "damla://check-for-updates"], capture_output=True)
    return r.returncode == 0


def pick_folder():
    r = subprocess.run(
        ["osascript", "-e", 'POSIX path of (choose folder with prompt "İndirme klasörünü seçin")'],
        capture_output=True, text=True,
    )
    return r.stdout.strip().rstrip("/") if r.returncode == 0 else ""


class Handler(BaseHTTPRequestHandler):
    def _reply(self, code, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", ""))
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _parts(self, write=True):
        origin = self.headers.get("Origin")
        ok = origin.startswith(ORIGIN_PREFIX) if origin else (not write and self.headers.get("Host") in HOSTS)
        if not ok:
            print(f"reject {self.command} {self.path} origin={origin!r}", file=sys.stderr, flush=True)
            self._reply(403, {"error": "forbidden"})
            return None
        return urlparse(self.path).path.strip("/").split("/")

    def _body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length) or b"{}")
            return data if isinstance(data, dict) else {}
        except ValueError:
            return {}

    def do_OPTIONS(self):
        self._reply(204 if self._parts() else 403, {})

    def do_GET(self):
        parts = self._parts(write=False)
        if parts is None:
            return
        if parts == ["jobs"]:
            with LOCK:
                return self._reply(200, {"jobs": [public(j) for j in JOBS], "ytdlp": TOOL["ytdlp"]})
        if parts == ["settings"]:
            return self._reply(200, {"settings": settings_view()})
        if parts == ["about"]:
            return self._reply(200, about())
        self._reply(404, {"error": "not found"})

    def do_PUT(self):
        parts = self._parts()
        if parts is None:
            return
        if parts == ["settings"]:
            SETTINGS.update(clean_settings(self._body(), SETTINGS))
            save_json(SETTINGS_FILE, SETTINGS)
            pump()
            return self._reply(200, {"settings": settings_view()})
        self._reply(404, {"error": "not found"})

    def do_POST(self):
        parts = self._parts()
        if parts is None:
            return
        if parts == ["jobs"]:
            items = self._body().get("items", [])
            return self._reply(202, {"jobs": enqueue(items if isinstance(items, list) else [])})
        if len(parts) == 3 and parts[0] == "jobs" and parts[2] == "cancel":
            return self._reply(200, {"ok": cancel(parts[1])})
        if len(parts) == 3 and parts[0] == "jobs" and parts[2] == "reveal":
            return self._reply(200, {"ok": reveal(parts[1])})
        if parts == ["update-app"]:
            return self._reply(200, {"ok": update_app()})
        if parts == ["update-ytdlp"]:
            return self._reply(200, update_ytdlp())
        if parts == ["pick-folder"]:
            folder = pick_folder()
            if folder:
                SETTINGS.update(clean_settings({"folder": folder}, SETTINGS))
                save_json(SETTINGS_FILE, SETTINGS)
            return self._reply(200, {"settings": settings_view()})
        self._reply(404, {"error": "not found"})


def exit_with_parent():
    parent = os.getppid()
    while True:
        time.sleep(2)
        if os.getppid() != parent:
            os._exit(0)


if __name__ == "__main__":
    if ".app/Contents/" in str(RES):
        threading.Thread(target=exit_with_parent, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", 8791), Handler).serve_forever()
