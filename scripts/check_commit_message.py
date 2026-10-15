import re
import sys
from pathlib import Path

TYPES = ("feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert")
HEADER = re.compile(
    rf"^(?P<type>{'|'.join(TYPES)})(\((?P<scope>[a-z0-9][a-z0-9-]*)\))?(?P<breaking>!)?: (?P<subject>\S.*)$"
)
AUTOMATIC = re.compile(r"^(Merge |Revert \"|fixup! |squash! )")
ATTRIBUTION = re.compile(r"co-authored-by:.*(claude|anthropic)|generated with.*claude", re.IGNORECASE)
MAX_HEADER = 72
MAX_BODY_LINE = 100


def problems(message: str) -> list[str]:
    lines = [line for line in message.splitlines() if not line.startswith("#")]
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return ["the commit message is empty"]
    header, body = lines[0], lines[1:]
    found = [f"attribution line is not allowed: {line!r}" for line in lines if ATTRIBUTION.search(line)]
    if AUTOMATIC.match(header):
        return found
    match = HEADER.match(header)
    if match is None:
        found.append(f"header must look like 'type(scope): subject' with type one of {', '.join(TYPES)}")
        return found
    subject = match["subject"]
    if len(header) > MAX_HEADER:
        found.append(f"header is {len(header)} characters, the limit is {MAX_HEADER}")
    if subject.endswith("."):
        found.append("subject must not end with a period")
    if subject[0].isupper():
        found.append("subject must start with a lowercase letter")
    if body and body[0].strip():
        found.append("a blank line must separate the header from the body")
    found.extend(
        f"body line is {len(line)} characters, the limit is {MAX_BODY_LINE}"
        for line in body
        if len(line) > MAX_BODY_LINE and not line.startswith(("http://", "https://"))
    )
    return found


def main() -> None:
    message = Path(sys.argv[1]).read_text(encoding="utf-8")
    found = problems(message)
    if found:
        print("commit message rejected (Conventional Commits):", file=sys.stderr)
        print("\n".join(f"  - {item}" for item in found), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
