"""History of decks: each deck's index.html is mirrored into a separate git repository.

Media are never versioned. The mirror holds <deck-folder>/index.html only, and opendeck commits
to it itself. It never pushes and never touches any other repository.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

IDENTITY = ["-c", "user.name=opendeck", "-c", "user.email=opendeck@localhost"]


def _git(mirror: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(mirror), *IDENTITY, *args],
                          check=check, capture_output=True, text=True)


def ensure_repo(mirror: Path) -> None:
    if (mirror / ".git").is_dir():
        return
    mirror.mkdir(parents=True, exist_ok=True)
    _git(mirror, "init", "-q")
    (mirror / "README.md").write_text(
        "# opendeck history\n\nEach folder mirrors one deck's `index.html`. "
        "Written and committed by opendeck; media live with the decks and are not versioned.\n",
        encoding="utf-8")
    _git(mirror, "add", "README.md")
    _git(mirror, "commit", "-q", "-m", "start the opendeck history mirror")


def commit(mirror: Path, deck_dir: Path, message: str) -> bool:
    """Copy <deck>/index.html into the mirror and commit it. False if nothing changed."""
    ensure_repo(mirror)
    target = mirror / deck_dir.name / "index.html"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(deck_dir / "index.html", target)
    _git(mirror, "add", "--", f"{deck_dir.name}/index.html")
    if _git(mirror, "diff", "--cached", "--quiet", check=False).returncode == 0:
        return False
    _git(mirror, "commit", "-q", "-m", message)
    return True


def log(mirror: Path, deck_name: str) -> list[tuple[str, str, str]]:
    """(hash, ISO date, subject) of the commits touching a deck, newest first."""
    if not (mirror / ".git").is_dir():
        return []
    out = _git(mirror, "log", "--format=%H%x09%cI%x09%s", "--", f"{deck_name}/index.html").stdout
    return [tuple(line.split("\t", 2)) for line in out.splitlines() if line]
