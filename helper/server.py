import itertools
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
from functools import cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

HOME = Path.home()
APP_DIR = HOME / "Library" / "Application Support" / "Damla"
SETTINGS_FILE = APP_DIR / "settings.json"
HISTORY_FILE = APP_DIR / "history.json"
ORIGIN_PREFIX = "safari-web-extension://"
PORT = 7560
API_VERSION = 1
HOSTS = (f"127.0.0.1:{PORT}", f"localhost:{PORT}")
GITHUB_REPO = "kaanrkaraman/damla"
YTDLP_REPO = "yt-dlp/yt-dlp"
CHECK_EVERY = 6 * 3600
DOWNLOAD_TIMEOUT = 60
MAX_RUNNING_PERCENT = 99
MAX_MESSAGE = 300
MAX_TITLE = 200
MAX_PROMPT = 120
PARENT_POLL_SECONDS = 2
FIRST_AV1_CHIP = 3
BREW_TIMEOUT = 300
RES = Path(__file__).resolve().parent
ROOT = RES.parent
BUNDLE_BIN = ROOT / "bin"
USER_BIN = APP_DIR / "bin"
CA_FILE = "/etc/ssl/cert.pem"
KEEP_FINISHED = 50
FINISHED = ("done", "error", "cancelled")
ACTIVE = ("queued", "running")

DEFAULTS = {
    "folder": str(HOME / "Downloads" / "Damla"),
    "quality": "best",
    "codec": "auto",
    "concurrent": 2,
    "by_site": False,
    "cookies": False,
    "reveal": False,
}
QUALITY = {"best": None, "1080": 1080, "720": 720, "audio": None}
PROGRESS_TEMPLATE = "download:@@" + "/".join(
    f"%(progress.{field})s"
    for field in ("downloaded_bytes", "total_bytes", "total_bytes_estimate", "fragment_index", "fragment_count")
)

type Job = dict[str, Any]
type Settings = dict[str, Any]

TOOL_PATH = [str(USER_BIN), str(BUNDLE_BIN), "/opt/homebrew/bin", "/usr/local/bin", os.environ.get("PATH", "")]
ENV = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PATH": ":".join(TOOL_PATH)}


def resolve_ytdlp() -> list[str]:
    for zipapp in (USER_BIN / "yt-dlp", BUNDLE_BIN / "yt-dlp"):
        if zipapp.is_file():
            return [sys.executable, str(zipapp)]
    return [shutil.which("yt-dlp", path=ENV["PATH"]) or "yt-dlp"]


SSL_CTX = ssl.create_default_context(cafile=CA_FILE if Path(CA_FILE).exists() else None)

LOCK = threading.Lock()
JOBS: list[Job] = []
SEQ = itertools.count(1)


def load_json[T](path: Path, default: T) -> T:
    try:
        return json.loads(path.read_text())
    except OSError, ValueError:
        return default


def save_json(path: Path, data: object) -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False))
    tmp.replace(path)


def clean_settings(raw: dict[str, Any], base: Settings) -> Settings:
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
    if raw.get("codec") in ("auto", "compat"):
        out["codec"] = raw["codec"]
    elif raw.get("codec") == "quality":
        out["codec"] = "auto"
    elif isinstance(raw.get("compat"), bool):
        out["codec"] = "compat" if raw["compat"] else "auto"
    for key in ("by_site", "cookies", "reveal"):
        if isinstance(raw.get(key), bool):
            out[key] = raw[key]
    return out


SETTINGS: dict = dict(DEFAULTS)


def public(job: Job) -> Job:
    return {k: v for k, v in job.items() if k not in ("proc", "seq")}


def settings_view() -> Settings:
    return {**SETTINGS, "folder_label": SETTINGS["folder"].replace(str(HOME), "~", 1)}


def ytdlp_version() -> str:
    try:
        return subprocess.run(
            [*TOOL["cmd"], "--version"], capture_output=True, text=True, env=ENV, check=False
        ).stdout.strip()
    except OSError:
        return ""


def read_app_version() -> str:
    for path in (RES / "VERSION", ROOT / "VERSION"):
        try:
            return path.read_text().strip()
        except OSError:
            continue
    return "0.0.0"


APP_VERSION = read_app_version()
TOOL: dict[str, Any] = {"ytdlp": None, "cmd": resolve_ytdlp()}
UPDATES: dict[str, Any] = {"checked": 0.0, "checking": False, "app": None, "ytdlp": None}


def parse_version(v: str | None) -> tuple[int, ...]:
    return tuple(int(x) for x in re.findall(r"\d+", v or ""))


def latest_release(repo: str) -> dict[str, str] | None:
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/releases/latest",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "damla"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8, context=SSL_CTX) as r:
            data = json.load(r)
        return {"version": data["tag_name"].lstrip("v"), "url": data["html_url"]}
    except OSError, ValueError, KeyError:
        return None


def check_updates() -> None:
    with LOCK:
        if UPDATES["checking"] or time.time() - UPDATES["checked"] < CHECK_EVERY:
            return
        UPDATES["checking"] = True
    app, ytdlp = latest_release(GITHUB_REPO), latest_release(YTDLP_REPO)
    with LOCK:
        UPDATES.update(app=app, ytdlp=ytdlp, checking=False, checked=time.time() if (app or ytdlp) else 0.0)


def about() -> dict[str, Any]:
    threading.Thread(target=check_updates, daemon=True).start()
    with LOCK:
        app, ytdlp = UPDATES["app"], UPDATES["ytdlp"]
        return {
            "helper": APP_VERSION,
            "api": API_VERSION,
            "ytdlp": TOOL["ytdlp"],
            "latest_app": app,
            "latest_ytdlp": ytdlp,
            "app_update": bool(app) and parse_version(app["version"]) > parse_version(APP_VERSION),
            "ytdlp_update": bool(ytdlp) and parse_version(ytdlp["version"]) > parse_version(TOOL["ytdlp"]),
            "checking": UPDATES["checking"],
            "bundled": ".app/Contents/" in str(RES),
        }


def download_ytdlp() -> list[str]:
    USER_BIN.mkdir(parents=True, exist_ok=True)
    target, part = USER_BIN / "yt-dlp", USER_BIN / "yt-dlp.part"
    url = f"https://github.com/{YTDLP_REPO}/releases/latest/download/yt-dlp"
    with urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT, context=SSL_CTX) as r, part.open("wb") as f:
        shutil.copyfileobj(r, f)
    check = subprocess.run(
        [sys.executable, str(part), "--version"], capture_output=True, text=True, timeout=DOWNLOAD_TIMEOUT, check=False
    )
    if check.returncode != 0 or not check.stdout.strip():
        part.unlink(missing_ok=True)
        raise OSError("downloaded yt-dlp does not run")
    part.replace(target)
    target.chmod(0o755)
    return [sys.executable, str(target)]


def update_ytdlp() -> dict[str, Any]:
    command_line = TOOL["cmd"]
    real = str(Path(command_line[0]).resolve())
    try:
        if len(command_line) == 1 and ("/Cellar/" in real or real.startswith("/opt/homebrew")):
            r = subprocess.run(
                ["brew", "upgrade", "yt-dlp"],
                capture_output=True,
                text=True,
                env=ENV,
                timeout=BREW_TIMEOUT,
                check=False,
            )
            ok, tail = r.returncode == 0, (r.stderr or r.stdout).strip().splitlines()[-1:]
            msg = tail[0][:200] if tail else ""
        else:
            TOOL["cmd"], ok, msg = download_ytdlp(), True, ""
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "msg": str(e)[:200]}
    TOOL["ytdlp"] = ytdlp_version()
    with LOCK:
        UPDATES["checked"] = 0.0
    threading.Thread(target=check_updates, daemon=True).start()
    return {"ok": ok, "version": TOOL["ytdlp"], "msg": msg}


def load_ytdlp_version() -> None:
    TOOL["ytdlp"] = ytdlp_version()


def has_av1_decoder(brand: str) -> bool:
    chip = re.search(r"Apple M(\d+)", brand)
    return chip is not None and int(chip[1]) >= FIRST_AV1_CHIP


@cache
def native_codecs() -> dict[str, str]:
    sysctl = ["sysctl", "-n", "machdep.cpu.brand_string"]
    brand = subprocess.run(sysctl, capture_output=True, text=True, check=False).stdout
    return {"h264": "avc", "hevc": "hvc|hev", **({"av1": "av01"} if has_av1_decoder(brand) else {})}


def native_format(codecs: dict[str, str]) -> str:
    return f"bv*[vcodec~='^({'|'.join(codecs.values())})']+ba/bv*+ba/b"


def command(job: Job, s: Settings, codecs: dict[str, str]) -> list[str]:
    cmd = [
        *TOOL["cmd"],
        "--no-playlist",
        "--no-warnings",
        "-q",
        "--progress",
        "--newline",
        "--progress-template",
        PROGRESS_TEMPLATE,
        "-o",
        "%(title).80B [%(id)s].%(ext)s",
        "--print",
        "after_move:filepath",
    ]
    quality = s["quality"]
    if quality == "audio":
        cmd += ["-x", "--audio-format", "m4a"]
    else:
        res = "res" if quality == "best" else f"res:{QUALITY[quality]}"
        if s["codec"] == "compat":
            cmd += ["-S", f"vcodec:h264,{res},acodec:aac"]
        else:
            cmd += ["-f", native_format(codecs), "-S", f"{res},vcodec,acodec:aac"]
        cmd += ["--merge-output-format", "mp4"]
    if s["cookies"]:
        cmd += ["--cookies-from-browser", "safari"]
    folder = Path(s["folder"])
    if s["by_site"]:
        folder /= (urlparse(job["url"]).hostname or "other").removeprefix("www.")
    return [*cmd, "-P", str(folder), "--", job["url"]]


def video_codec(path: str) -> str:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", path], capture_output=True, text=True, env=ENV, check=False)
    m = re.search(r"Video: (\w+)", r.stderr)
    return m.group(1) if m else ""


def h264_encoder() -> list[str]:
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True, env=ENV, check=False
    ).stdout
    if " libx264 " in out:
        return ["-c:v", "libx264", "-crf", "20", "-preset", "veryfast"]
    return ["-c:v", "h264_videotoolbox", "-b:v", "10M"]


def ensure_playable(job: Job, path: str) -> str:
    if video_codec(path) in (*native_codecs(), ""):
        return path
    with LOCK:
        job["msg"] = "@converting"
    final = Path(path).with_suffix(".mp4")
    tmp = final.with_name(final.stem + ".converting.mp4")
    r = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            path,
            *h264_encoder(),
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            str(tmp),
        ],
        capture_output=True,
        env=ENV,
        check=False,
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


def progress_percent(line: str) -> int | None:
    done, total, estimate, fragment, fragments = (line.removeprefix("@@").split("/") + [""] * 5)[:5]
    size = next((int(x) for x in (total, estimate) if x.isdigit() and int(x) > 0), 0)
    if done.isdigit() and size:
        return int(int(done) * 100 / size)
    if fragment.isdigit() and fragments.isdigit() and int(fragments) > 0:
        return int(int(fragment) * 100 / int(fragments))
    return None


def read_output(job: Job, proc: subprocess.Popen[str]) -> str:
    path = ""
    for raw in proc.stdout or []:
        line = raw.strip()
        if line.startswith("@@"):
            percent = progress_percent(line)
            if percent is not None:
                with LOCK:
                    job["percent"] = max(job["percent"], min(MAX_RUNNING_PERCENT, percent))
        elif line:
            path = line
    return path


def settle(job: Job, s: Settings, outcome: tuple[int, str, list[str]]) -> bool:
    code, path, err = outcome
    with LOCK:
        job.pop("proc", None)
        if job["state"] != "cancelled":
            ok = code == 0 and bool(path)
            job["state"] = "done" if ok else "error"
            job["percent"] = 100 if ok else job["percent"]
            job["path"] = path if ok else ""
            job["file"] = Path(path).name if ok else ""
            if ok and not job["title"]:
                job["title"] = re.sub(r"\s*\[[^\]]+\]$", "", Path(path).stem)
            job["msg"] = "" if ok else (err[-1] if err else "@failed").removeprefix("ERROR: ")[:MAX_MESSAGE]
        job["finished"] = time.time()
        succeeded = job["state"] == "done"
        trim()
        save_json(HISTORY_FILE, [public(j) for j in JOBS if j["state"] in FINISHED])
    return succeeded and s["reveal"]


def run(job: Job, s: Settings) -> None:
    outcome: tuple[int, str, list[str]] = (1, "", ["@missing"])
    try:
        proc = subprocess.Popen(
            command(job, s, native_codecs()), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=ENV
        )
    except OSError:
        pass
    else:
        with LOCK:
            job["proc"] = proc
        path = read_output(job, proc)
        err = proc.stderr.read().strip().splitlines() if proc.stderr else []
        code = proc.wait()
        if code == 0 and path and s["quality"] != "audio":
            path = ensure_playable(job, path)
        outcome = (code, path, err)
    if settle(job, s, outcome):
        subprocess.run(["open", "-R", job["path"]], check=False)
    pump()


def trim() -> None:
    finished, keep = 0, []
    for j in JOBS:
        if j["state"] in ACTIVE:
            keep.append(j)
        else:
            finished += 1
            if finished <= KEEP_FINISHED:
                keep.append(j)
    JOBS[:] = keep


def pump() -> None:
    with LOCK:
        running = sum(j["state"] == "running" for j in JOBS)
        for j in sorted((j for j in JOBS if j["state"] == "queued"), key=lambda j: j["seq"]):
            if running >= SETTINGS["concurrent"]:
                break
            j["state"] = "running"
            running += 1
            threading.Thread(target=run, args=(j, dict(SETTINGS)), daemon=True).start()


def new_job(item: dict[str, Any]) -> Job:
    thumb = str(item.get("thumb", ""))
    return {
        "id": uuid.uuid4().hex[:8],
        "seq": next(SEQ),
        "url": item["url"],
        "title": str(item.get("title", ""))[:MAX_TITLE],
        "thumb": thumb if thumb.startswith(("http://", "https://")) else "",
        "state": "queued",
        "percent": 0,
        "file": "",
        "path": "",
        "msg": "",
        "finished": 0,
    }


def enqueue(items: list[dict[str, Any]]) -> list[Job]:
    out, fresh = [], []
    with LOCK:
        for item in items:
            url = item.get("url", "")
            if urlparse(url).scheme not in ("http", "https"):
                continue
            existing = next((j for j in JOBS if j["url"] == url and j["state"] in ACTIVE), None)
            if existing:
                out.append(existing)
                continue
            job = new_job(item)
            fresh.append(job)
            out.append(job)
        JOBS[0:0] = fresh
        trim()
        result = [public(j) for j in out]
    pump()
    return result


def find(job_id: str) -> Job | None:
    return next((j for j in JOBS if j["id"] == job_id), None)


def cancel(job_id: str) -> bool:
    with LOCK:
        job = find(job_id)
        if not job or job["state"] not in ACTIVE:
            return False
        job["state"], job["finished"] = "cancelled", time.time()
        proc = job.get("proc")
    if proc:
        proc.terminate()
    return True


def reveal(job_id: str) -> bool:
    with LOCK:
        job = find(job_id)
        path = job["path"] if job else ""
    if not path or not Path(path).exists():
        return False
    subprocess.run(["open", "-R", path], check=False)
    return True


def update_app() -> bool:
    app = RES.parent.parent.parent
    if app.suffix != ".app":
        return False
    r = subprocess.run(["open", "-g", "-a", str(app), "damla://check-for-updates"], capture_output=True, check=False)
    return r.returncode == 0


def pick_folder(prompt: str) -> str:
    script = ["-e", "on run argv", "-e", "POSIX path of (choose folder with prompt (item 1 of argv))", "-e", "end run"]
    r = subprocess.run(["osascript", *script, "--", prompt[:MAX_PROMPT]], capture_output=True, text=True, check=False)
    return r.stdout.strip().rstrip("/") if r.returncode == 0 else ""


def choose_folder(body: dict[str, Any]) -> Settings:
    folder = pick_folder(str(body.get("prompt") or "Choose a folder"))
    if folder:
        SETTINGS.update(clean_settings({"folder": folder}, SETTINGS))
        save_json(SETTINGS_FILE, SETTINGS)
    return {"settings": settings_view()}


def store_settings(body: dict[str, Any]) -> Settings:
    SETTINGS.update(clean_settings(body, SETTINGS))
    save_json(SETTINGS_FILE, SETTINGS)
    pump()
    return {"settings": settings_view()}


def list_jobs() -> dict[str, Any]:
    with LOCK:
        return {"jobs": [public(j) for j in JOBS], "ytdlp": TOOL["ytdlp"]}


def route(method: str, parts: list[str], body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    match method, parts:
        case "GET", ["jobs"]:
            return 200, list_jobs()
        case "GET", ["settings"]:
            return 200, {"settings": settings_view()}
        case "GET", ["about"]:
            return 200, about()
        case "PUT", ["settings"]:
            return 200, store_settings(body)
        case "POST", ["jobs"]:
            items = body.get("items", [])
            return 202, {"jobs": enqueue(items if isinstance(items, list) else [])}
        case "POST", ["jobs", job_id, "cancel"]:
            return 200, {"ok": cancel(job_id)}
        case "POST", ["jobs", job_id, "reveal"]:
            return 200, {"ok": reveal(job_id)}
        case "POST", ["update-app"]:
            return 200, {"ok": update_app()}
        case "POST", ["update-ytdlp"]:
            return 200, update_ytdlp()
        case "POST", ["pick-folder"]:
            return 200, choose_folder(body)
        case _:
            return 404, {"error": "not found"}


def is_allowed(origin: str | None, host: str | None, *, write: bool) -> bool:
    if origin:
        return origin.startswith(ORIGIN_PREFIX)
    return not write and host in HOSTS


class Handler(BaseHTTPRequestHandler):
    def _reply(self, code: int, body: dict[str, Any]) -> None:
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", ""))
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    def _handle(self, *, write: bool) -> None:
        origin = self.headers.get("Origin")
        if not is_allowed(origin, self.headers.get("Host"), write=write):
            print(f"reject {self.command} {self.path} origin={origin!r}", file=sys.stderr, flush=True)
            self._reply(403, {"error": "forbidden"})
            return
        parts = urlparse(self.path).path.strip("/").split("/")
        self._reply(*route(self.command, parts, self._body()))

    def do_OPTIONS(self) -> None:
        origin = self.headers.get("Origin")
        allowed = is_allowed(origin, self.headers.get("Host"), write=True)
        self._reply(204 if allowed else 403, {})

    def do_GET(self) -> None:
        self._handle(write=False)

    def do_PUT(self) -> None:
        self._handle(write=True)

    def do_POST(self) -> None:
        self._handle(write=True)


def exit_with_parent() -> None:
    parent = os.getppid()
    while True:
        time.sleep(PARENT_POLL_SECONDS)
        if os.getppid() != parent:
            os._exit(0)


def main() -> None:
    SETTINGS.update(clean_settings(load_json(SETTINGS_FILE, {}), DEFAULTS))
    JOBS.extend(job for job in load_json(HISTORY_FILE, []) if job.get("state") in FINISHED)
    threading.Thread(target=load_ytdlp_version, daemon=True).start()
    threading.Thread(target=check_updates, daemon=True).start()
    if ".app/Contents/" in str(RES):
        threading.Thread(target=exit_with_parent, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
