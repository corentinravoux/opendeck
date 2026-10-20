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
snapshot's index, and push() (and the pre-push hook, for a hand-typed push) refuses to send any
commit holding a folder that is not on the whitelist. A trashed deck leaves the whitelist, and a
new deck never takes the folder name of one with a history, so visibility never passes to it.

The tree is staged under <mirror>/.git/opendeck-public with its own index, so unchanged files are
not rehashed. Each snapshot's parent is the last one pushed to the same destination (remote URL
and branch), so nothing unpushed piles up, and a destination never receives snapshots it did not
already have: a new destination starts from a snapshot with no parent.
"""

from __future__ import annotations

import fnmatch
import shlex
import os
import shutil
import subprocess
from html import escape
from pathlib import Path
from typing import TYPE_CHECKING

from ..export import runtime
from . import store, versioning

if TYPE_CHECKING:
    from ..config import Config

BRANCH = "public"
LEGACY_PUSHED = "refs/opendeck/pushed"      # one boundary for every destination (before per-destination boundaries)
PUSHED = "refs/opendeck/pushed-to"          # + /<key of remote URL and branch>: the last snapshot sent there
STAGE = "opendeck-public"
STAGE_LOCK = "opendeck-public.lock"         # one build or push at a time (the history lock is not held)
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
    """Make deck `name` public or private (or move its entry to `rename_to`: a private deck stays
    private, and so does whatever stood at `rename_to`) and commit the whitelist to the history.
    False if nothing changed. The read, update and commit hold the mirror's lock."""
    if not paths_ok(name) or (rename_to is not None and not paths_ok(rename_to)):
        raise ValueError(f"invalid deck name {name!r}")
    with versioning.locked(mirror):
        versioning.ensure_repo(mirror)
        names = set(public_decks(mirror))
        before = set(names)
        if rename_to is not None:
            was_public = name in names
            names -= {name, rename_to}
            if was_public:
                names.add(rename_to)
        elif public:
            names.add(name)
        else:
            names.discard(name)
        if names == before and (mirror / GITIGNORE).is_file():
            return False
        what = f"renamed to {rename_to}" if rename_to is not None else ("public" if public else "private")
        return _write_whitelist(mirror, names, f"{name}: {what}")


def forget(mirror: Path, names) -> bool:
    """Take decks that no longer exist (trashed, deleted) off the whitelist, so that a later deck
    under the same folder name does not inherit their visibility. False if none was on it."""
    with versioning.locked(mirror):
        public = set(public_decks(mirror))
        gone = public & set(names)
        if not gone:
            return False
        return _write_whitelist(mirror, public - gone, f"{', '.join(sorted(gone))}: gone, off the whitelist")


def _write_whitelist(mirror: Path, names, message: str) -> bool:
    require_history(mirror)
    versioning.ensure_repo(mirror)
    tmp = mirror / f".{GITIGNORE}.tmp"
    tmp.write_text(_HEADER + "".join(f"!/{n}/\n" for n in sorted(names)), encoding="utf-8")
    os.replace(tmp, mirror / GITIGNORE)      # a reader (the pre-push hook) never sees half a list
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


def push_url(mirror: Path, remote: str) -> str:
    """The URL git pushes to for `remote` (a remote's name, or a URL as it is): what the pre-push
    hook is given, so both key a destination the same way."""
    out = versioning._git(mirror, "remote", "get-url", "--push", "--", remote, check=False)
    return out.stdout.strip() if out.returncode == 0 and out.stdout.strip() else remote


def _boundary_ref(url: str, remote_ref: str) -> str:
    import hashlib

    key = hashlib.sha256(f"{url}\n{remote_ref}".encode()).hexdigest()[:24]
    return f"{PUSHED}/{key}"


def pushed(mirror: Path, url: str, branch: str = "main") -> str:
    """The last snapshot pushed to `branch` at `url` ("" if none)."""
    return _git(mirror, "rev-parse", "--verify", "-q", _boundary_ref(url, f"refs/heads/{branch}"), check=False)


def adopt_legacy_boundary(mirror: Path, url: str, branch: str = "main") -> None:
    """Earlier versions kept one pushed boundary for every destination: give it to `url`, the
    destination it was pushed to (publish_remote), and drop it."""
    with versioning.locked(mirror, STAGE_LOCK):
        legacy = _git(mirror, "rev-parse", "--verify", "-q", LEGACY_PUSHED, check=False)
        if not legacy:
            return
        if not pushed(mirror, url, branch):
            _git(mirror, "update-ref", _boundary_ref(url, f"refs/heads/{branch}"), legacy)
        _git(mirror, "update-ref", "-d", LEGACY_PUSHED)


def build(decks_root: Path, mirror: Path, exclude: tuple[str, ...] | list[str] = (),
          title: str = "Talks", lfs: bool = False, index_url: str = "",
          remote: str | None = None, branch: str = "main") -> tuple[str, list[str], bool]:
    """Commit every deck to the history, then snapshot the public ones on branch `public`, for
    `branch` of `remote` (its parent: the last snapshot pushed there; none without `remote`, or
    for a destination never pushed to). Returns (commit, published deck names, whether branch
    `public` moved)."""
    require_history(mirror)
    versioning.ensure_repo(mirror)
    all_decks = store.list_decks(decks_root)
    for d in all_decks:
        versioning.commit(mirror, decks_root / d.name, f"{d.name}: publish")
    with versioning.locked(mirror):
        if not (mirror / GITIGNORE).is_file():
            _write_whitelist(mirror, [], "start the publish whitelist: every deck private")
        existing = {d.name for d in all_decks}
        forget(mirror, [n for n in public_decks(mirror) if n not in existing])
        public = set(public_decks(mirror))
    decks = [d for d in all_decks if d.name in public and included(d.name, exclude)]
    with versioning.locked(mirror, STAGE_LOCK):
        return _snapshot(decks_root, mirror, decks, title, lfs, index_url, remote, branch)


def _snapshot(decks_root: Path, mirror: Path, decks: list[store.DeckInfo], title: str, lfs: bool,
              index_url: str, remote: str | None, branch: str) -> tuple[str, list[str], bool]:
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
    # files staged before LFS was turned on (or off) are re-filtered, once: unchanged media are
    # otherwise not reread
    marker, filters = git_dir / f"{STAGE}.filters", "lfs" if lfs else "plain"
    if not marker.is_file() or marker.read_text(encoding="utf-8") != filters:
        _git(mirror, *work, "add", "--renormalize", ".", env=env)
        marker.write_text(filters, encoding="utf-8")
    tree = _git(mirror, *work, "write-tree", env=env)
    names = [d.name for d in decks]
    prev = _git(mirror, "rev-parse", "--verify", "-q", f"refs/heads/{BRANCH}", check=False)
    base = pushed(mirror, push_url(mirror, remote), branch) if remote else ""
    tree_of = lambda c: _git(mirror, "rev-parse", f"{c}^{{tree}}")
    parents_of = lambda c: _git(mirror, "rev-list", "--parents", "-n", "1", c).split()[1:]
    if base and tree_of(base) == tree:
        commit = base                        # what the destination already has
    elif prev and tree_of(prev) == tree and parents_of(prev) == ([base] if base else []):
        commit = prev
    else:
        commit = _git(mirror, "commit-tree", tree, *(["-p", base] if base else []), "-m", f"publish {len(decks)} decks")
    if commit == prev:
        return prev, names, False
    _git(mirror, "update-ref", f"refs/heads/{BRANCH}", commit)
    return commit, names, True


HOOK = """\
#!/bin/sh
# Written by opendeck. Only the website snapshot (branch {branch}) may leave this repository, and
# only when it holds public decks alone: the history of every deck stays on this machine.
url=$2
input=$(cat)
top=$(git rev-parse --show-toplevel)
zero=0000000000000000000000000000000000000000
echo "$input" | while read -r local_ref local_sha remote_ref remote_sha; do
  [ -z "$local_ref" ] && continue
  [ "$local_sha" = "$zero" ] && continue
  if [ "$local_ref" != "refs/heads/{branch}" ]; then
    echo "opendeck: refusing to push $local_ref; only the website snapshot (branch {branch}) is pushed" >&2
    exit 1
  fi
  {python} -c "import sys; from pathlib import Path; from opendeck.deck import publish; publish.check(Path(sys.argv[1]), *sys.argv[2:])" \
    "$top" "$url" "$remote_ref" "$local_sha" "$remote_sha" || exit 1
done || exit 1
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


WrongBranchError = versioning.WrongBranchError
require_history = versioning.require_history


class PushError(RuntimeError):
    """git push failed; the message is git's."""


def check(mirror: Path, url: str | None = None, remote_ref: str = "refs/heads/main",
          sha: str | None = None, remote_sha: str | None = None) -> str:
    """The snapshot about to be pushed (`sha`, default: branch `public`), after checking that it
    and every commit under it that the destination does not have yet hold only public decks, by
    the whitelist as it is now. What the destination has: the last snapshot pushed to `remote_ref`
    at `url`, and `remote_sha` (its current tip, as the pre-push hook is told). Without `url`, the
    whole ancestry is checked. Raises PrivateDeckError otherwise."""
    tip = _git(mirror, "rev-parse", "--verify", sha or f"refs/heads/{BRANCH}")
    have = []
    if url:
        have.append(_git(mirror, "rev-parse", "--verify", "-q", _boundary_ref(url, remote_ref), check=False))
    if remote_sha and set(remote_sha) != {"0"}:
        have.append(_git(mirror, "rev-parse", "--verify", "-q", f"{remote_sha}^{{commit}}", check=False))
    public = set(public_decks(mirror))
    # the tip always: it may be a snapshot the destination has, holding a deck made private since
    commits = [tip] + [c for c in _git(mirror, "rev-list", tip, *(f"^{h}" for h in have if h)).split() if c != tip]
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
    with versioning.locked(mirror, STAGE_LOCK):      # no build moves branch `public` meanwhile
        url, ref = push_url(mirror, remote), f"refs/heads/{branch}"
        tip = check(mirror, url, ref)
        install_hook(mirror)
        # no prompt: from the editor there is no terminal to type a password into
        r = subprocess.run(["git", "-C", str(mirror), "push", remote, f"refs/heads/{BRANCH}:{ref}"],
                           capture_output=True, text=True, env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
        if r.returncode != 0:
            raise PushError(r.stderr.strip() or f"git push exited with {r.returncode}")
        _git(mirror, "update-ref", _boundary_ref(url, ref), tip)


def last_published(mirror: Path, remote: str, branch: str = "main") -> str:
    """When the last snapshot was pushed to `branch` of `remote` (ISO 8601; "" if never)."""
    # an earlier version's single boundary counts until the next publish adopts it
    sha = (pushed(mirror, push_url(mirror, remote), branch)
           or _git(mirror, "rev-parse", "--verify", "-q", LEGACY_PUSHED, check=False))
    return _git(mirror, "log", "-1", "--format=%cI", sha) if sha else ""


def publish_site(config: Config, remote: str | None = None, push_it: bool = True) -> tuple[str, list[str], bool, bool]:
    """What `opendeck publish` and the editor's Publish button do: snapshot the public decks, then
    push the snapshot to `remote` (default: publish_remote). Returns (snapshot, its decks, whether
    it changed, whether it was pushed)."""
    versioning.MIRROR_MEDIA = config.mirror_media
    remote = remote or config.publish_remote
    if remote and remote == config.publish_remote:
        adopt_legacy_boundary(config.mirror_root, push_url(config.mirror_root, remote))
    commit, names, changed = build(config.decks_root, config.mirror_root, config.publish_exclude,
                                   config.publish_title, config.publish_lfs, config.publish_index_url,
                                   remote=remote or None)
    if not push_it or not remote:
        return commit, names, changed, False
    push(config.mirror_root, remote)
    return commit, names, changed, True
