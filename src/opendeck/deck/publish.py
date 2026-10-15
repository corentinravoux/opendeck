"""Publishing: every deck that is not excluded, as a website pushed to a git remote.

The history mirror's own branch (every edit of every deck) is never pushed. Publishing builds a
separate branch, `public`, whose commits are snapshots of the published decks:

    .gitignore            deny by default: only the decks made public are listed (see below)
    index.html            the list of talks
    .nojekyll             served as plain files (GitHub Pages: deploy from the branch, root)
    <deck>/index.html     each deck self-contained: it opens on its own, online or downloaded
    <deck>/lib/           the deck runtime
    <deck>/media/         the media the deck uses

Every deck is private unless made public. The list of public decks is the whitelist of
<mirror>/publish.gitignore, versioned in the local history and published as the snapshot's
.gitignore; opendeck rewrites it only when a deck changes visibility (or a public deck is renamed).
A private deck is kept out three times: it is not staged, the .gitignore keeps it out of the
snapshot's index, and push() refuses any snapshot holding a folder that is not on the whitelist.

The tree is staged under <mirror>/.git/opendeck-public with its own index, so unchanged files are
not rehashed. Each snapshot's parent is the last pushed one: nothing unpushed piles up.
"""

from __future__ import annotations

import fnmatch
import os
import shutil
import subprocess
from html import escape
from pathlib import Path

from ..export import runtime
from . import store, versioning

BRANCH = "public"
PUSHED = "refs/opendeck/pushed"
STAGE = "opendeck-public"
GITIGNORE = "publish.gitignore"
_HEADER = """\
# Written by opendeck. Every deck is private: no deck folder is published unless it is listed
# below with a leading "!". opendeck changes this list only when a deck is made public or private.
/*/
"""


def included(name: str, exclude: tuple[str, ...] | list[str]) -> bool:
    return not any(fnmatch.fnmatchcase(name, pattern) for pattern in exclude)


def public_decks(mirror: Path) -> list[str]:
    """Folder names of the public decks: the whitelist of publish.gitignore."""
    path = mirror / GITIGNORE
    if not path.is_file():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    return sorted(line[2:-1] for line in lines if line.startswith("!/") and line.endswith("/"))


def set_public(mirror: Path, name: str, public: bool, rename_to: str | None = None) -> bool:
    """Make deck `name` public or private (or move its entry to `rename_to`) and commit the
    whitelist to the history. False if nothing changed."""
    if not paths_ok(name) or (rename_to is not None and not paths_ok(rename_to)):
        raise ValueError(f"invalid deck name {name!r}")
    versioning.ensure_repo(mirror)
    names = set(public_decks(mirror))
    before = set(names)
    if rename_to is not None:
        if name in names:
            names = (names - {name}) | {rename_to}
    elif public:
        names.add(name)
    else:
        names.discard(name)
    if names == before and (mirror / GITIGNORE).is_file():
        return False
    what = f"renamed to {rename_to}" if rename_to is not None else ("public" if public else "private")
    return _write_whitelist(mirror, names, f"{name}: {what}")


def _write_whitelist(mirror: Path, names, message: str) -> bool:
    (mirror / GITIGNORE).write_text(_HEADER + "".join(f"!/{n}/\n" for n in sorted(names)), encoding="utf-8")
    versioning._git(mirror, "add", "--", GITIGNORE)
    if versioning._git(mirror, "diff", "--cached", "--quiet", check=False).returncode == 0:
        return False
    versioning._git(mirror, "commit", "-q", "-m", message)
    return True


def paths_ok(name: str) -> bool:
    import re

    return bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,200}", name))


def _git(mirror: Path, *args: str, env: dict | None = None, check: bool = True) -> str:
    out = subprocess.run(["git", "-C", str(mirror), *versioning.IDENTITY, *args], check=check,
                         capture_output=True, text=True, env=None if env is None else os.environ | env)
    return out.stdout.strip()


def talk_index(decks: list[store.DeckInfo], title: str = "Talks") -> str:
    """The root page: one line per talk, newest first, grouped by year."""
    rows, year = [], None
    for d in decks:
        y, m = d.name[:4], d.name[5:7]
        if y != year:
            rows.append(f'<h2>{escape(y)}</h2>')
            year = y
        rows.append(f'<a class="talk" href="{escape(d.name)}/index.html"><span class="when">{escape(y)}-{escape(m)}'
                    f'</span><span class="title">{escape(d.title)}</span><span class="n">{d.slides} slides</span></a>')
    body = "\n".join(rows)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="opendeck">
<title>{escape(title)}</title>
<style>
:root {{ --bg: #f7f8fa; --fg: #17202a; --muted: #5b6673; --line: #dde2e8; --hover: #eef2f6; --accent: #1f6fb2; }}
@media (prefers-color-scheme: dark) {{
  :root {{ --bg: #0b1018; --fg: #e6edf3; --muted: #93a1b0; --line: #223040; --hover: #131c28; --accent: #6cb4f0; }}
}}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--bg); color: var(--fg);
       font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }}
main {{ max-width: 860px; margin: 0 auto; padding: 48px 16px 64px; }}
h1 {{ font-size: 28px; margin: 0 0 4px; }}
p.sub {{ color: var(--muted); margin: 0 0 28px; }}
h2 {{ font-size: 15px; color: var(--muted); font-weight: 600; margin: 28px 0 6px; letter-spacing: .04em; }}
a.talk {{ display: grid; grid-template-columns: 76px 1fr auto; gap: 12px; align-items: baseline;
         padding: 10px 8px; border-top: 1px solid var(--line); color: inherit; text-decoration: none; }}
a.talk:hover {{ background: var(--hover); }}
a.talk:hover .title {{ color: var(--accent); }}
.when, .n {{ color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; }}
@media (max-width: 560px) {{ a.talk {{ grid-template-columns: 1fr; gap: 2px; }} .n {{ display: none; }} }}
</style>
</head>
<body>
<main>
<h1>{escape(title)}</h1>
<p class="sub">{len(decks)} slide decks. Each opens in the browser; arrow keys move between slides.</p>
{body}
</main>
</body>
</html>
"""


def _stage(stage: Path, decks_root: Path, decks: list[store.DeckInfo], mirror_gitignore: Path,
           title: str = "Talks") -> None:
    keep = {d.name for d in decks} | {"index.html", ".nojekyll", "README.md", ".gitignore"}
    stage.mkdir(parents=True, exist_ok=True)
    for entry in stage.iterdir():
        if entry.name not in keep:
            shutil.rmtree(entry) if entry.is_dir() else entry.unlink()
    for d in decks:
        src, dst = decks_root / d.name, stage / d.name
        dst.mkdir(exist_ok=True)
        page = (src / "index.html").read_text(encoding="utf-8")
        (dst / "index.html").write_text(page, encoding="utf-8")
        versioning._sync_media(page, src, dst)
        runtime.install(dst)
    (stage / "index.html").write_text(talk_index(decks, title), encoding="utf-8")
    (stage / ".nojekyll").write_text("", encoding="utf-8")
    shutil.copyfile(mirror_gitignore, stage / ".gitignore")
    (stage / "README.md").write_text(
        f"# {title}\n\nSlide decks published with opendeck: "
        "each folder is one self-contained talk (`index.html`, its runtime in `lib/`, its media). "
        "Open `index.html` for the list.\n", encoding="utf-8")


def build(decks_root: Path, mirror: Path, exclude: tuple[str, ...] | list[str] = (),
          title: str = "Talks") -> tuple[str, list[str], bool]:
    """Commit every deck to the history, then snapshot the public ones on branch `public`.
    Returns (commit, published deck names, whether the snapshot changed)."""
    all_decks = store.list_decks(decks_root)
    for d in all_decks:
        versioning.commit(mirror, decks_root / d.name, f"{d.name}: publish")
    if not (mirror / GITIGNORE).is_file():
        _write_whitelist(mirror, [], "start the publish whitelist: every deck private")
    public = set(public_decks(mirror))
    decks = [d for d in all_decks if d.name in public and included(d.name, exclude)]
    git_dir = mirror / ".git"
    stage = git_dir / STAGE
    _stage(stage, decks_root, decks, mirror / GITIGNORE, title)
    env = {"GIT_INDEX_FILE": str(git_dir / f"{STAGE}.index")}
    work = ["--git-dir", str(git_dir), "--work-tree", str(stage)]
    _git(mirror, *work, "add", "-A", ".", env=env)
    tree = _git(mirror, *work, "write-tree", env=env)
    prev = _git(mirror, "rev-parse", "--verify", "-q", f"refs/heads/{BRANCH}", check=False)
    if prev and _git(mirror, "rev-parse", f"{prev}^{{tree}}") == tree:
        return prev, [d.name for d in decks], False
    pushed = _git(mirror, "rev-parse", "--verify", "-q", PUSHED, check=False)
    parent = ["-p", pushed] if pushed else []
    commit = _git(mirror, "commit-tree", tree, *parent, "-m", f"publish {len(decks)} decks")
    _git(mirror, "update-ref", f"refs/heads/{BRANCH}", commit)
    return commit, [d.name for d in decks], True


class PrivateDeckError(RuntimeError):
    pass


def check(mirror: Path) -> str:
    """The snapshot about to be pushed, after checking that it and every unpushed commit under
    it hold only public decks. Raises PrivateDeckError otherwise."""
    tip = _git(mirror, "rev-parse", "--verify", f"refs/heads/{BRANCH}")
    pushed = _git(mirror, "rev-parse", "--verify", "-q", PUSHED, check=False)
    public = set(public_decks(mirror))
    commits = _git(mirror, "rev-list", tip, *([f"^{pushed}"] if pushed else [])).split()
    for c in commits:
        folders = {line.split("\t", 1)[1] for line in _git(mirror, "ls-tree", c).splitlines()
                   if line.split()[1] == "tree"}
        private = sorted(folders - public)
        if private:
            raise PrivateDeckError(f"snapshot {c[:7]} holds decks that are not public: {', '.join(private)}")
    return tip


def push(mirror: Path, remote: str, branch: str = "main") -> None:
    """Push the latest snapshot (only branch `public`, never the history) to `branch` of the remote."""
    tip = check(mirror)
    subprocess.run(["git", "-C", str(mirror), "push", remote, f"{tip}:refs/heads/{branch}"], check=True)
    _git(mirror, "update-ref", PUSHED, tip)
