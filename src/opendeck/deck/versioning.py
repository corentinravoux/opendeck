"""History of decks: each deck is mirrored into a separate git repository.

The mirror holds <deck-folder>/index.html and, if the config asks for it (mirror_media), the
media files that page uses (media names are content hashes: a file never changes once written).
opendeck commits to it itself. It is local: only `opendeck publish` (deck/publish.py, optional)
pushes anything, and never this history branch, only website snapshots.
"""

from __future__ import annotations

import fcntl
import os
import re
import shutil
import subprocess
import threading
from contextlib import contextmanager
from pathlib import Path

IDENTITY = ["-c", "user.name=opendeck", "-c", "user.email=opendeck@localhost"]
HISTORY = "main"            # the branch the history lives on; `public` is the website snapshot
MIRROR_MEDIA = False        # keep media in the mirror too: set from Config.mirror_media at start-up


def _git(mirror: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(mirror), *IDENTITY, *args],
                          check=check, capture_output=True, text=True)


_held = threading.local()


@contextmanager
def locked(mirror: Path, name: str = "opendeck.lock"):
    """Hold a lock of the mirror (<mirror>/.git/<name>): one writer at a time, across threads and
    processes (the server's thread pool, the command line). The default lock guards the history
    index and the publish whitelist. Re-entrant within a thread."""
    mirror.mkdir(parents=True, exist_ok=True)
    if not (mirror / ".git").is_dir():
        _git(mirror, "init", "-q", "-b", "main")
    path = (mirror / ".git" / name).resolve()
    held = _held.__dict__.setdefault("paths", set())
    if path in held:
        yield
        return
    with open(path, "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)    # per open file: threads of one process exclude each other too
        held.add(path)
        try:
            yield
        finally:
            held.discard(path)


def ensure_repo(mirror: Path) -> None:
    with locked(mirror):
        if _git(mirror, "rev-parse", "--verify", "-q", "HEAD", check=False).returncode == 0:
            return
        (mirror / "README.md").write_text(
            "# opendeck history\n\nEach folder mirrors one deck's `index.html` and the media it uses. "
            "Written and committed by opendeck.\n",
            encoding="utf-8")
        _git(mirror, "add", "README.md")
        _git(mirror, "commit", "-q", "-m", "start the opendeck history mirror")


def branch_state(mirror: Path) -> dict:
    """Which branch the mirror has checked out. Everything opendeck reads or commits there (the
    history, the publish whitelist) belongs on branch `main`: `ok` is false on any other, and
    `can_switch` says whether switch_to_history() may go back (main exists, no uncommitted change)."""
    if not (mirror / ".git").is_dir():
        return {"branch": HISTORY, "ok": True, "can_switch": False}   # created on main when first used
    branch = _git(mirror, "symbolic-ref", "--short", "-q", "HEAD", check=False).stdout.strip()
    if branch == HISTORY:
        return {"branch": branch, "ok": True, "can_switch": False}
    exists = _git(mirror, "rev-parse", "--verify", "-q", f"refs/heads/{HISTORY}", check=False).returncode == 0
    clean = not _git(mirror, "status", "--porcelain", "--untracked-files=no", check=False).stdout.strip()
    return {"branch": branch or "(detached)", "ok": False, "can_switch": exists and clean}


def on_history(mirror: Path) -> bool:
    return branch_state(mirror)["ok"]


class WrongBranchError(RuntimeError):
    """The mirror has another branch than `main` checked out."""


def require_history(mirror: Path) -> None:
    """Refuse to change the history (or the publish whitelist) while another branch is checked out."""
    state = branch_state(mirror)
    if not state["ok"]:
        raise WrongBranchError(f"the history {mirror} is on branch {state['branch']}, not {HISTORY}: "
                               f"switch it back (git -C {mirror} checkout {HISTORY})")


def switch_to_history(mirror: Path) -> dict:
    """Check out branch `main` again (after a hand-made checkout of another one). Refuses when main
    does not exist or the mirror has uncommitted changes."""
    with locked(mirror):
        state = branch_state(mirror)
        if state["ok"]:
            return state
        if not state["can_switch"]:
            raise RuntimeError(f"cannot switch {mirror} from {state['branch']} to {HISTORY}: "
                               f"no branch {HISTORY}, or uncommitted changes there")
        _git(mirror, "checkout", "-q", HISTORY)
        return branch_state(mirror)


# any quoted media path: src, poster, data-print, data-background-image, url(...)
_MEDIA_REF = re.compile(r"""(?<=["'(])media/[A-Za-z0-9_.-]+(?=["')])""")


def _sync_media(page: str, deck_dir: Path, target: Path) -> None:
    """Make <target>/media hold exactly the media files the page uses (hard links when possible)."""
    used = {rel.split("/", 1)[1] for rel in _MEDIA_REF.findall(page) if (deck_dir / rel).is_file()}
    folder = target / "media"
    if folder.is_dir():
        for f in folder.iterdir():
            if f.name not in used:
                f.unlink()
    if used:
        folder.mkdir(exist_ok=True)
    for name in used:
        dst = folder / name
        if dst.exists():
            continue
        try:
            os.link(deck_dir / "media" / name, dst)
        except OSError:
            shutil.copyfile(deck_dir / "media" / name, dst)


def commit(mirror: Path, deck_dir: Path, message: str, media: bool | None = None) -> bool:
    """Copy <deck>/index.html (and, with media or MIRROR_MEDIA, the media it uses) into the mirror
    and commit. False if nothing changed."""
    with locked(mirror):
        if not on_history(mirror):
            return False             # never into another branch; the next save after the switch catches up
        ensure_repo(mirror)
        target = mirror / deck_dir.name
        target.mkdir(parents=True, exist_ok=True)
        page = (deck_dir / "index.html").read_text(encoding="utf-8")
        shutil.copyfile(deck_dir / "index.html", target / "index.html")
        if MIRROR_MEDIA if media is None else media:
            _sync_media(page, deck_dir, target)
        _git(mirror, "add", "-A", "--", deck_dir.name)
        if _git(mirror, "diff", "--cached", "--quiet", check=False).returncode == 0:
            return False
        _git(mirror, "commit", "-q", "-m", message)
        return True


def log(mirror: Path, deck_name: str) -> list[tuple[str, str, str]]:
    """(hash, ISO date, subject) of the commits touching a deck, newest first; through renames
    of its folder (see rename())."""
    if not (mirror / ".git").is_dir():
        return []
    out = _git(mirror, "log", "--follow", "--format=%H%x09%cI%x09%s", "--", f"{deck_name}/index.html").stdout
    return [tuple(line.split("\t", 2)) for line in out.splitlines() if line]


def _check_hash(rev: str) -> str:
    import re

    if not re.fullmatch(r"[0-9a-f]{7,40}", rev):
        raise ValueError(f"not a commit hash: {rev!r}")
    return rev


def show(mirror: Path, deck_name: str, rev: str) -> str:
    """index.html of a deck as it was at commit `rev`."""
    out = _git(mirror, "show", f"{_check_hash(rev)}:{deck_name}/index.html", check=False)
    if out.returncode != 0:  # a version from before the deck's folder was renamed
        out = _git(mirror, "show", f"{rev}:{_path_at(mirror, deck_name, rev)}", check=False)
    if out.returncode != 0:
        raise FileNotFoundError(f"no version {rev} of {deck_name}")
    return out.stdout


def restore(mirror: Path, deck_dir: Path, rev: str) -> None:
    """Put back a past version of the deck; the current state is committed first, so this can be undone."""
    with locked(mirror):
        require_history(mirror)
        page = show(mirror, deck_dir.name, rev)
        commit(mirror, deck_dir, f"{deck_dir.name}: before restoring {rev[:7]}")
        tmp = deck_dir / ".index.html.tmp"
        tmp.write_text(page, encoding="utf-8")
        tmp.replace(deck_dir / "index.html")
        commit(mirror, deck_dir, f"{deck_dir.name}: restored {rev[:7]}")


def rename(mirror: Path, old_name: str, new_name: str, deck_dir: Path | None = None) -> bool:
    """Move a deck's history folder old_name -> new_name with `git mv`, so `git log --follow`
    (and log() above) still reach its past versions, and commit "<old> -> <new>: rename". With
    `deck_dir` (the deck, already in its new folder), its current page goes into the same commit.
    False, with nothing done, when the mirror has no history for old_name. On failure the mirror
    is put back as it was."""
    if old_name == new_name or not (mirror / ".git").is_dir():
        return False
    with locked(mirror):
        require_history(mirror)
        return _rename(mirror, old_name, new_name, deck_dir)


def _rename(mirror: Path, old_name: str, new_name: str, deck_dir: Path | None) -> bool:
    if not _git(mirror, "ls-files", "--", old_name).stdout.strip():
        return False
    if (mirror / new_name).exists():
        raise FileExistsError(f"the history already has a folder {new_name!r}")
    if deck_dir is not None and deck_dir.name != new_name:
        raise ValueError(f"{deck_dir} is not the deck {new_name!r}")
    message = f"{old_name} -> {new_name}: rename"
    _git(mirror, "mv", "--", old_name, new_name)
    try:
        if deck_dir is not None:
            commit(mirror, deck_dir, message)
        else:
            _git(mirror, "commit", "-q", "-m", message)
    except BaseException:
        _git(mirror, "reset", "-q", check=False)
        if (mirror / new_name).is_dir() and not (mirror / old_name).exists():
            os.rename(mirror / new_name, mirror / old_name)
        _git(mirror, "checkout", "-q", "--", old_name, check=False)
        raise
    return True


def _path_at(mirror: Path, deck_name: str, rev: str) -> str:
    """Where the deck's index.html was at commit `rev`, following renames of its folder."""
    out = _git(mirror, "log", "--follow", "--name-only", "--format=%x01%H", "--",
               f"{deck_name}/index.html", check=False).stdout
    for chunk in out.split("\x01")[1:]:
        lines = [line for line in chunk.splitlines() if line]
        if len(lines) > 1 and lines[0].startswith(rev):
            return lines[1]
    return f"{deck_name}/index.html"
