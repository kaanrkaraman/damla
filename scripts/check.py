import json
import plistlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXTENSION = ROOT / "extension"
LOCALES = EXTENSION / "_locales"
PROJECT = ROOT / "Damla" / "Damla.xcodeproj" / "project.pbxproj"
SERVER = ROOT / "helper" / "server.py"
DYNAMIC_PREFIXES = ("msg_",)
PLURAL_SUFFIXES = ("_one", "_other")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def find(pattern: str, text: str, label: str) -> str:
    match = re.search(pattern, text, re.MULTILINE)
    if match is None:
        raise SystemExit(f"{label}: pattern not found: {pattern}")
    return match[1]


def check_versions(errors: list[str]) -> str:
    version = read(ROOT / "VERSION").strip()
    manifest = json.loads(read(EXTENSION / "manifest.json"))["version"]
    project = read(PROJECT)
    marketing = set(re.findall(r"MARKETING_VERSION = ([^;]+);", project))
    build = set(re.findall(r"CURRENT_PROJECT_VERSION = ([^;]+);", project))
    for label, found in (("manifest.json", {manifest}), ("MARKETING_VERSION", marketing), ("CURRENT_PROJECT_VERSION", build)):
        if found != {version}:
            errors.append(f"version: VERSION is {version} but {label} is {sorted(found)}")
    if not re.search(rf"^## \[{re.escape(version)}\]", read(ROOT / "CHANGELOG.md"), re.MULTILINE):
        errors.append(f"changelog: CHANGELOG.md has no section for {version}")
    return version


def check_contract(errors: list[str]) -> None:
    server = read(SERVER)
    background = read(EXTENSION / "background.js")
    popup = read(EXTENSION / "popup.js")
    server_port = find(r"^PORT = (\d+)", server, "server.py")
    extension_port = find(r"127\.0\.0\.1:(\d+)", background, "background.js")
    if server_port != extension_port:
        errors.append(f"port: helper uses {server_port}, extension uses {extension_port}")
    server_api = find(r"^API_VERSION = (\d+)", server, "server.py")
    popup_api = find(r"^const REQUIRED_API = (\d+)", popup, "popup.js")
    if server_api != popup_api:
        errors.append(f"api: helper speaks {server_api}, extension requires {popup_api}")
    repo = find(r'^GITHUB_REPO = "([^"]+)"', server, "server.py")
    feed = plistlib.loads((ROOT / "Damla" / "Damla" / "Info.plist").read_bytes())["SUFeedURL"]
    if f"github.com/{repo}/" not in feed:
        errors.append(f"repo: SUFeedURL {feed} does not point at {repo}")
    if f"github.com/{repo}/" not in read(EXTENSION / "popup.js"):
        errors.append(f"repo: popup.js does not link to {repo}")


def load_messages() -> dict[str, dict[str, dict]]:
    return {folder.name: json.loads(read(folder / "messages.json")) for folder in sorted(LOCALES.iterdir()) if folder.is_dir()}


def placeholders(entry: dict) -> set[str]:
    return set(entry.get("placeholders", {}))


def used_message_keys() -> set[str]:
    sources = [read(path) for path in (EXTENSION / "popup.js", EXTENSION / "content.js", EXTENSION / "background.js", EXTENSION / "popup.html")]
    manifest = read(EXTENSION / "manifest.json")
    keys = set(re.findall(r"__MSG_(\w+)__", manifest))
    for source in sources:
        keys |= set(re.findall(r"""\bt\(\s*["'](\w+)["']""", source))
        keys |= {f"{key}{suffix}" for key in re.findall(r"""\btn\(\s*["'](\w+)["']""", source) for suffix in PLURAL_SUFFIXES}
    return keys


def check_messages(errors: list[str]) -> None:
    messages = load_messages()
    default = json.loads(read(EXTENSION / "manifest.json"))["default_locale"]
    if default not in messages:
        errors.append(f"locales: default locale {default} has no folder")
        return
    reference = messages[default]
    for lang, table in messages.items():
        missing, extra = reference.keys() - table.keys(), table.keys() - reference.keys()
        if missing:
            errors.append(f"locales/{lang}: missing {sorted(missing)}")
        if extra:
            errors.append(f"locales/{lang}: unknown {sorted(extra)}")
        for key in reference.keys() & table.keys():
            if placeholders(reference[key]) != placeholders(table[key]):
                errors.append(f"locales/{lang}: placeholders of {key} differ from {default}")
    used = used_message_keys()
    for key in sorted(used - reference.keys()):
        errors.append(f"locales: code uses undefined message {key}")
    for key in sorted(reference.keys() - used):
        if not key.startswith(DYNAMIC_PREFIXES):
            errors.append(f"locales: message {key} is never used")


def check_manifest(errors: list[str]) -> None:
    manifest = json.loads(read(EXTENSION / "manifest.json"))
    referenced = {manifest["action"]["default_popup"], manifest["background"]["service_worker"]}
    referenced |= set(manifest["icons"].values()) | set(manifest["action"]["default_icon"].values())
    for script in manifest["content_scripts"]:
        referenced |= set(script["js"])
    for path in sorted(referenced):
        if not (EXTENSION / path).is_file():
            errors.append(f"manifest: {path} does not exist")
    popup = read(EXTENSION / "popup.html")
    for path in re.findall(r'(?:src|href)="([^"]+)"', popup):
        if not (EXTENSION / path).is_file():
            errors.append(f"popup.html: {path} does not exist")
    project = read(PROJECT)
    for item in sorted(EXTENSION.iterdir()):
        if item.name.startswith("."):
            continue
        if f"../../extension/{item.name}" not in project:
            errors.append(f"xcodeproj: extension/{item.name} is not bundled into the Safari extension")


def check_catalog(errors: list[str]) -> None:
    catalog = ROOT / "Damla" / "Damla" / "Localizable.xcstrings"
    if not catalog.is_file():
        return
    data = json.loads(read(catalog))
    languages = set(messages for messages in load_messages())
    for key, entry in data["strings"].items():
        missing = languages - entry.get("localizations", {}).keys()
        if missing:
            errors.append(f"Localizable.xcstrings: {key} lacks {sorted(missing)}")
    code = read(ROOT / "Damla" / "Damla" / "AppDelegate.swift")
    used = set(re.findall(r'String\(localized: "([\w.]+)"', code)) | set(re.findall(r'NSLocalizedString\("([\w.]+)"', code))
    for key in sorted(used - data["strings"].keys()):
        errors.append(f"Localizable.xcstrings: code uses undefined string {key}")
    for key in sorted(data["strings"].keys() - used):
        errors.append(f"Localizable.xcstrings: string {key} is never used")


def check_syntax(errors: list[str]) -> None:
    subprocess_checks = [([sys.executable, "-I", "-m", "py_compile", str(path)], path) for path in (SERVER, ROOT / "scripts" / "bump_version.py", Path(__file__))]
    subprocess_checks += [(["node", "--check", str(path)], path) for path in sorted(EXTENSION.glob("*.js"))]
    for command, path in subprocess_checks:
        try:
            result = subprocess.run(command, capture_output=True, text=True)
        except FileNotFoundError:
            continue
        if result.returncode != 0:
            errors.append(f"syntax: {path.relative_to(ROOT)}: {result.stderr.strip().splitlines()[-1] if result.stderr else 'failed'}")


def main() -> None:
    errors: list[str] = []
    version = check_versions(errors)
    check_contract(errors)
    check_messages(errors)
    check_manifest(errors)
    check_catalog(errors)
    check_syntax(errors)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        raise SystemExit(f"{len(errors)} problem(s)")
    print(f"ok: {version}")


if __name__ == "__main__":
    main()
