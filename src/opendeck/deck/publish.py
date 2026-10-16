"""Publishing: every deck that is not excluded, as a website pushed to a git remote.

The history mirror's own branch (every edit of every deck) is never pushed. Publishing builds a
separate branch, `public`, whose commits are snapshots of the published decks:

    .gitignore            deny by default: only the decks made public are listed (see below)
    index.html            the list of talks
    .nojekyll             served as plain files (GitHub Pages: deploy from the branch, root)
    talks.json            the published talks, for a website to list them (title, date, thumbnail)
    <deck>/index.html     each deck self-contained: it opens on its own, online or downloaded
    <deck>/thumb.webp     its first slide, rendered by the system Chrome (when there is one)
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
import shlex
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
LFS_ATTRIBUTES = "*/media/** filter=lfs diff=lfs merge=lfs -text\n"
WORKFLOW = """# Written by opendeck: deploys this repository as a GitHub Pages site. The media are in Git LFS,
# which Pages does not serve from a branch, so the site is built here with the LFS files pulled
# (kept in the Actions cache between deploys, to spare the LFS bandwidth quota).
# Repository Settings > Pages > Source: GitHub Actions.
name: pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - name: List the LFS objects
        run: git lfs ls-files --long | cut -d' ' -f1 | sort > .lfs-ids
      - uses: actions/cache@v4
        with:
          path: .git/lfs/objects
          key: lfs-${{ hashFiles('.lfs-ids') }}
          restore-keys: lfs-
      - name: Pull the LFS objects
        run: git lfs pull && rm .lfs-ids
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - id: deployment
        uses: actions/deploy-pages@v4
"""
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


THUMB_WIDTH = 640


def redirect_page(url: str, title: str) -> str:
    """The root page when the talks are listed elsewhere (publish_index_url): a redirect."""
    u = escape(url, quote=True)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{escape(title)}</title>
<link rel="canonical" href="{u}">
<meta http-equiv="refresh" content="0; url={u}">
</head>
<body><p><a href="{u}">{escape(title)}</a></p></body>
</html>
"""


def talks_json(decks: list[store.DeckInfo], thumbs: dict[str, str], title: str) -> str:
    import json

    # no timestamp: an unchanged deck list must give an unchanged snapshot
    talks = [{"name": d.name, "title": d.title, "date": d.name[:7], "slides": d.slides,
              "url": f"{d.name}/index.html", "thumb": thumbs.get(d.name)} for d in decks]
    return json.dumps({"title": title, "talks": talks}, ensure_ascii=False, indent=1) + "\n"


def _thumbnails(stage: Path, decks: list[store.DeckInfo], cache_file: Path) -> dict[str, str]:
    """<deck>/thumb.webp for each deck: its first slide in the deck's own viewer, re-rendered only
    when the page changed. Without Playwright and a system Chrome, decks simply have no thumbnail."""
    import hashlib
    import io
    import json

    cache = json.loads(cache_file.read_text()) if cache_file.is_file() else {}
    out, todo = {}, []
    for d in decks:
        digest = hashlib.sha256((stage / d.name / "index.html").read_bytes()).hexdigest()
        if cache.get(d.name) == digest and (stage / d.name / "thumb.webp").is_file():
            out[d.name] = f"{d.name}/thumb.webp"
        else:
            todo.append((d, digest))
    if todo:
        try:
            from PIL import Image
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch(channel="chrome", headless=True)
                try:
                    for d, digest in todo:
                        page = browser.new_page(viewport={"width": d.width, "height": d.height})
                        try:
                            page.goto((stage / d.name / "index.html").as_uri() + "?static")
                            page.wait_for_selector("html[data-od-ready]", state="attached", timeout=60000)
                            page.wait_for_timeout(300)
                            img = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
                            img = img.resize((THUMB_WIDTH, round(THUMB_WIDTH * d.height / d.width)), Image.LANCZOS)
                            img.save(stage / d.name / "thumb.webp", "WEBP", quality=82, method=6)
                            cache[d.name] = digest
                            out[d.name] = f"{d.name}/thumb.webp"
                        except Exception:
                            pass
                        finally:
                            page.close()
                finally:
                    browser.close()
        except Exception:
            pass
    cache_file.write_text(json.dumps(cache, indent=1))
    return out


def _stage(stage: Path, decks_root: Path, decks: list[store.DeckInfo], mirror_gitignore: Path,
           title: str = "Talks", lfs: bool = False, index_url: str = "") -> None:
    keep = {d.name for d in decks} | {"index.html", "talks.json", ".nojekyll", "README.md", ".gitignore"}
    if lfs:
        keep |= {".gitattributes", ".github"}
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
    thumbs = _thumbnails(stage, decks, stage.parent / f"{STAGE}.thumbs.json")
    (stage / "talks.json").write_text(talks_json(decks, thumbs, title), encoding="utf-8")
    page = redirect_page(index_url, title) if index_url else talk_index(decks, title)
    (stage / "index.html").write_text(page, encoding="utf-8")
    (stage / ".nojekyll").write_text("", encoding="utf-8")
    shutil.copyfile(mirror_gitignore, stage / ".gitignore")
    if lfs:
        with open(stage / ".gitignore", "a", encoding="utf-8") as f:
            f.write("# the workflow that deploys the site (media in Git LFS)\n!/.github/\n")
        (stage / ".gitattributes").write_text(LFS_ATTRIBUTES, encoding="utf-8")
        (stage / ".github" / "workflows").mkdir(parents=True, exist_ok=True)
        (stage / ".github" / "workflows" / "pages.yml").write_text(WORKFLOW, encoding="utf-8")
    (stage / "README.md").write_text(
        f"# {title}\n\nSlide decks published with opendeck: "
        "each folder is one self-contained talk (`index.html`, its runtime in `lib/`, its media). "
        "Open `index.html` for the list.\n", encoding="utf-8")


def build(decks_root: Path, mirror: Path, exclude: tuple[str, ...] | list[str] = (),
          title: str = "Talks", lfs: bool = False, index_url: str = "") -> tuple[str, list[str], bool]:
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
    if lfs:
        # the clean filter turns media into LFS pointers as they are staged; the pre-push hook uploads them
        _git(mirror, "lfs", "install", "--local", "--skip-repo")   # filters only: our hook calls git-lfs
    install_hook(mirror)                     # after git-lfs, which writes its own pre-push hook
    _stage(stage, decks_root, decks, mirror / GITIGNORE, title, lfs, index_url)
    env = {"GIT_INDEX_FILE": str(git_dir / f"{STAGE}.index")}
    work = ["--git-dir", str(git_dir), "--work-tree", str(stage)]
    _git(mirror, *work, "add", "-A", ".", env=env)
    _git(mirror, *work, "add", "--renormalize", ".", env=env)   # media staged before LFS was turned on
    tree = _git(mirror, *work, "write-tree", env=env)
    prev = _git(mirror, "rev-parse", "--verify", "-q", f"refs/heads/{BRANCH}", check=False)
    if prev and _git(mirror, "rev-parse", f"{prev}^{{tree}}") == tree:
        return prev, [d.name for d in decks], False
    pushed = _git(mirror, "rev-parse", "--verify", "-q", PUSHED, check=False)
    parent = ["-p", pushed] if pushed else []
    commit = _git(mirror, "commit-tree", tree, *parent, "-m", f"publish {len(decks)} decks")
    _git(mirror, "update-ref", f"refs/heads/{BRANCH}", commit)
    return commit, [d.name for d in decks], True


HOOK = """\
#!/bin/sh
# Written by opendeck. Only the website snapshot (branch {branch}) may leave this repository, and
# only when it holds public decks alone: the history of every deck stays on this machine.
input=$(cat)
zero=0000000000000000000000000000000000000000
echo "$input" | while read -r local_ref local_sha remote_ref remote_sha; do
  [ -z "$local_ref" ] && continue
  [ "$local_sha" = "$zero" ] && continue
  if [ "$local_ref" != "refs/heads/{branch}" ]; then
    echo "opendeck: refusing to push $local_ref; only the website snapshot (branch {branch}) is pushed" >&2
    exit 1
  fi
done || exit 1
{python} -c "import sys; from pathlib import Path; from opendeck.deck import publish; publish.check(Path(sys.argv[1]))" "$(git rev-parse --show-toplevel)" || exit 1
if command -v git-lfs >/dev/null 2>&1; then
  echo "$input" | git lfs pre-push "$@"
fi
"""


def install_hook(mirror: Path) -> None:
    """The pre-push hook of the mirror: only branch `public`, only public decks (then git-lfs)."""
    import sys

    hook = mirror / ".git" / "hooks" / "pre-push"
    hook.parent.mkdir(parents=True, exist_ok=True)
    hook.write_text(HOOK.format(branch=BRANCH, python=shlex.quote(sys.executable)), encoding="utf-8")
    hook.chmod(0o755)


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
        # every folder but dot-folders (.github: never a deck, deck names cannot start with ".")
        folders = {line.split("\t", 1)[1] for line in _git(mirror, "ls-tree", c).splitlines()
                   if line.split()[1] == "tree" and not line.split("\t", 1)[1].startswith(".")}
        private = sorted(folders - public)
        if private:
            raise PrivateDeckError(f"snapshot {c[:7]} holds decks that are not public: {', '.join(private)}")
    return tip


def push(mirror: Path, remote: str, branch: str = "main") -> None:
    """Push the latest snapshot (only branch `public`, never the history) to `branch` of the remote."""
    tip = check(mirror)
    install_hook(mirror)
    subprocess.run(["git", "-C", str(mirror), "push", remote, f"refs/heads/{BRANCH}:refs/heads/{branch}"], check=True)
    _git(mirror, "update-ref", PUSHED, tip)
