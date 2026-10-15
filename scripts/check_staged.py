import re
import subprocess
import sys

MAX_FILE_BYTES = 1_000_000
FORBIDDEN_PATHS = re.compile(
    r"(^|/)(packaging/(build|cache)/|node_modules/|extension/dist/|\.venv/)|\.(p12|p8|cer|csr|pem|key|mobileprovision)$"
)
SECRET_PATTERNS = {
    "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "GitHub token": re.compile(r"\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b"),
    "Apple app-specific password": re.compile(r"\b[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}\b"),
    "AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
}


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def staged_files() -> list[str]:
    return [name for name in git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").split("\0") if name]


def added_lines(path: str) -> list[str]:
    diff = git("diff", "--cached", "--unified=0", "--no-color", "--", path)
    return [line[1:] for line in diff.splitlines() if line.startswith("+") and not line.startswith("+++")]


def problems() -> list[str]:
    found: list[str] = []
    for path in staged_files():
        if FORBIDDEN_PATHS.search(path):
            found.append(f"{path}: generated or secret files must not be committed")
            continue
        size = int(git("cat-file", "-s", f":{path}"))
        if size > MAX_FILE_BYTES:
            found.append(f"{path}: {size} bytes is over the {MAX_FILE_BYTES} byte limit")
        for line in added_lines(path):
            found.extend(
                f"{path}: looks like a {label}" for label, pattern in SECRET_PATTERNS.items() if pattern.search(line)
            )
            if line != line.rstrip():
                found.append(f"{path}: trailing whitespace")
                break
    return found


def main() -> None:
    found = problems()
    if found:
        print("\n".join(found), file=sys.stderr)
        raise SystemExit(f"{len(found)} problem(s) in the staged changes")


if __name__ == "__main__":
    main()
