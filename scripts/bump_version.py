import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
version = sys.argv[1] if len(sys.argv) > 1 else ""
if not re.fullmatch(r"\d+\.\d+\.\d+", version):
    sys.exit("usage: bump_version.py MAJOR.MINOR.PATCH")

(ROOT / "VERSION").write_text(f"{version}\n")
manifest = ROOT / "extension" / "manifest.json"
manifest.write_text(re.sub(r'"version": "[^"]+"', f'"version": "{version}"', manifest.read_text(), count=1))
project = ROOT / "Damla" / "Damla.xcodeproj" / "project.pbxproj"
text = re.sub(r"MARKETING_VERSION = [^;]+;", f"MARKETING_VERSION = {version};", project.read_text())
project.write_text(re.sub(r"CURRENT_PROJECT_VERSION = [^;]+;", f"CURRENT_PROJECT_VERSION = {version};", text))
print(f"version -> {version}")
