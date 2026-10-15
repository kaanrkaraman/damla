import json
import plistlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXTENSION = ROOT / "extension"
SOURCES = EXTENSION / "src"
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
    for label, found in (
        ("manifest.json", {manifest}),
        ("MARKETING_VERSION", marketing),
        ("CURRENT_PROJECT_VERSION", build),
    ):
        if found != {version}:
            errors.append(f"version: VERSION is {version} but {label} is {sorted(found)}")
    if not re.search(rf"^## \[{re.escape(version)}\]", read(ROOT / "CHANGELOG.md"), re.MULTILINE):
        errors.append(f"changelog: CHANGELOG.md has no section for {version}")
    return version


def check_contract(errors: list[str]) -> None:
    server = read(SERVER)
    helper_client = read(SOURCES / "helper.ts")
    popup = read(SOURCES / "popup.ts")
    server_port = find(r"^PORT = (\d+)", server, "server.py")
    extension_port = find(r"127\.0\.0\.1:(\d+)", helper_client, "helper.ts")
    if server_port != extension_port:
        errors.append(f"port: helper uses {server_port}, extension uses {extension_port}")
    server_api = find(r"^API_VERSION = (\d+)", server, "server.py")
    popup_api = find(r"^const REQUIRED_API = (\d+)", popup, "popup.ts")
    if server_api != popup_api:
        errors.append(f"api: helper speaks {server_api}, extension requires {popup_api}")
    repo = find(r'^GITHUB_REPO = "([^"]+)"', server, "server.py")
    feed = plistlib.loads((ROOT / "Damla" / "Damla" / "Info.plist").read_bytes())["SUFeedURL"]
    if f"github.com/{repo}/" not in feed:
        errors.append(f"repo: SUFeedURL {feed} does not point at {repo}")
    if f"github.com/{repo}/" not in popup:
        errors.append(f"repo: popup.ts does not link to {repo}")


def load_messages() -> dict[str, dict[str, dict]]:
    return {
        folder.name: json.loads(read(folder / "messages.json"))
        for folder in sorted(LOCALES.iterdir())
        if folder.is_dir()
    }


def placeholders(entry: dict) -> set[str]:
    return set(entry.get("placeholders", {}))


def used_message_keys() -> set[str]:
    sources = [read(path) for path in sorted(SOURCES.glob("*.ts"))]
    manifest = read(EXTENSION / "manifest.json")
    keys = set(re.findall(r"__MSG_(\w+)__", manifest))
    for source in sources:
        keys |= set(re.findall(r"""\bt\(\s*["'](\w+)["']""", source))
        keys |= {
            f"{key}{suffix}" for key in re.findall(r"""\btn\(\s*["'](\w+)["']""", source) for suffix in PLURAL_SUFFIXES
        }
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
        errors.extend(
            f"locales/{lang}: placeholders of {key} differ from {default}"
            for key in sorted(reference.keys() & table.keys())
            if placeholders(reference[key]) != placeholders(table[key])
        )
    used = used_message_keys()
    errors.extend(f"locales: code uses undefined message {key}" for key in sorted(used - reference.keys()))
    errors.extend(
        f"locales: message {key} is never used"
        for key in sorted(reference.keys() - used)
        if not key.startswith(DYNAMIC_PREFIXES)
    )


def check_manifest(errors: list[str]) -> None:
    manifest = json.loads(read(EXTENSION / "manifest.json"))
    referenced = {manifest["action"]["default_popup"], manifest["background"]["service_worker"]}
    referenced |= set(manifest["icons"].values()) | set(manifest["action"]["default_icon"].values())
    for script in manifest["content_scripts"]:
        referenced |= set(script["js"])
    popup = read(EXTENSION / "popup.html")
    referenced |= set(re.findall(r'(?:src|href)="([^"]+)"', popup))
    errors.extend(
        f"manifest: {path} has neither a static file nor a TypeScript entry point"
        for path in sorted(referenced)
        if not (EXTENSION / path).is_file() and not (SOURCES / Path(path).with_suffix(".ts")).is_file()
    )
    project = read(PROJECT)
    bundled = {Path(path).parts[0] for path in referenced} | {"_locales", "manifest.json"}
    errors.extend(
        f"xcodeproj: extension/dist/{name} is not bundled into the Safari extension"
        for name in sorted(bundled)
        if f"../../extension/dist/{name}" not in project
    )


def check_catalog(errors: list[str]) -> None:
    catalog = ROOT / "Damla" / "Damla" / "Localizable.xcstrings"
    if not catalog.is_file():
        return
    data = json.loads(read(catalog))
    languages = set(load_messages())
    for key, entry in data["strings"].items():
        missing = languages - entry.get("localizations", {}).keys()
        if missing:
            errors.append(f"Localizable.xcstrings: {key} lacks {sorted(missing)}")
    code = read(ROOT / "Damla" / "Damla" / "AppDelegate.swift")
    used = set(re.findall(r'String\(localized: "([\w.]+)"', code)) | set(
        re.findall(r'NSLocalizedString\("([\w.]+)"', code)
    )
    errors.extend(
        f"Localizable.xcstrings: code uses undefined string {key}" for key in sorted(used - data["strings"].keys())
    )
    errors.extend(f"Localizable.xcstrings: string {key} is never used" for key in sorted(data["strings"].keys() - used))


def main() -> None:
    errors: list[str] = []
    version = check_versions(errors)
    check_contract(errors)
    check_messages(errors)
    check_manifest(errors)
    check_catalog(errors)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        raise SystemExit(f"{len(errors)} problem(s)")
    print(f"ok: {version}")


if __name__ == "__main__":
    main()
