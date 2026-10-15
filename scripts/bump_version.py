import re
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPECTED_ARGUMENTS = 2
SEMVER = re.compile(r"\d+\.\d+\.\d+")


def replace_once(path: Path, pattern: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text, count=1)
    if count != 1:
        raise SystemExit(f"{path.relative_to(ROOT)}: pattern not found: {pattern}")
    path.write_text(updated, encoding="utf-8")


def replace_all(path: Path, pattern: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text)
    if count == 0:
        raise SystemExit(f"{path.relative_to(ROOT)}: pattern not found: {pattern}")
    path.write_text(updated, encoding="utf-8")


def main() -> None:
    version = sys.argv[1] if len(sys.argv) == EXPECTED_ARGUMENTS else ""
    if not SEMVER.fullmatch(version):
        raise SystemExit("usage: bump_version.py MAJOR.MINOR.PATCH")
    changelog = ROOT / "CHANGELOG.md"
    if f"## [{version}]" in changelog.read_text(encoding="utf-8"):
        raise SystemExit(f"CHANGELOG.md already has a section for {version}")

    (ROOT / "VERSION").write_text(f"{version}\n", encoding="utf-8")
    replace_once(ROOT / "extension" / "manifest.json", r'"version": "[^"]+"', f'"version": "{version}"')
    project = ROOT / "Damla" / "Damla.xcodeproj" / "project.pbxproj"
    replace_all(project, r"MARKETING_VERSION = [^;]+;", f"MARKETING_VERSION = {version};")
    replace_all(project, r"CURRENT_PROJECT_VERSION = [^;]+;", f"CURRENT_PROJECT_VERSION = {version};")
    replace_once(
        changelog,
        r"## \[Unreleased\]\n",
        f"## [Unreleased]\n\n## [{version}] - {datetime.now(UTC).date().isoformat()}\n",
    )
    print(f"version -> {version}; the Unreleased notes in CHANGELOG.md now sit under [{version}]")


if __name__ == "__main__":
    main()
