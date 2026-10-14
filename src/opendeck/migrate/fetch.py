"""Download every deck of a slides.com account as an HTML zip and a PDF.

It drives the user's own, already logged-in Chrome over the DevTools protocol. Start that Chrome with:

    google-chrome --user-data-dir=<profile> --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1

For each deck it opens the editor, opens the Export panel and clicks only "Download HTML" and
"Download PDF". It clicks nothing else and types nothing.

Every request that is not a plain GET to slides.com is logged in requests.log. Outside --dry-run,
such a request is aborted unless it matches the allow-list. The allow-list is reviewed after a
dry run on a throwaway deck.

The downloads land in <inbox>/<slug>.zip and <inbox>/<slug>.pdf. manifest.json records what is
done, so an interrupted run resumes where it stopped.
"""

from __future__ import annotations

import json
import os
import re
import time
import zipfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

SITE = "https://slides.com"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
KINDS = {"zip": "button.download-zip-button", "pdf": "button.download-pdf-button"}


@dataclass(frozen=True)
class DeckEntry:
    slug: str
    title: str
    deck_id: str
    created_at: str  # as the listing gives it, e.g. "2026-10-14 08:22:18 UTC"

    @property
    def folder_name(self) -> str:
        """Deck folder name under Slides_deck: YYYY-MM_<slug>."""
        created = parse_created(self.created_at)
        return f"{created:%Y-%m}_{self.slug}"


def parse_created(text: str) -> datetime:
    return datetime.strptime(text.strip(), "%Y-%m-%d %H:%M:%S %Z").replace(tzinfo=timezone.utc)


def _write_json(path: Path, data) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


class Manifest:
    """What has been downloaded: {slug: {"zip": {...}, "pdf": {...}}}."""

    def __init__(self, path: Path):
        self.path = path
        self.data: dict[str, dict] = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}

    def done(self, slug: str, kind: str) -> bool:
        entry = self.data.get(slug, {}).get(kind)
        return bool(entry) and (self.path.parent / entry["file"]).is_file()

    def mark(self, slug: str, kind: str, file: Path) -> None:
        self.data.setdefault(slug, {})[kind] = {
            "file": file.name,
            "bytes": file.stat().st_size,
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        _write_json(self.path, self.data)


class RequestGuard:
    """Decides what happens to each request the export page makes.

    Plain GETs pass. A mutating request to slides.com is logged; it passes in a dry run or when
    it matches the allow-list, and is aborted otherwise. Mutating requests to other hosts
    (analytics and the like) cannot touch the decks: they are logged and passed.
    """

    def __init__(self, log_path: Path, allow: list[str], dry_run: bool):
        self.log_path = log_path
        self.allow = [re.compile(p) for p in allow]
        self.dry_run = dry_run

    def decide(self, method: str, url: str) -> str:
        if method.upper() in SAFE_METHODS:
            return "pass"
        host = urlsplit(url).hostname or ""
        if not (host == "slides.com" or host.endswith(".slides.com")):
            return "log"
        if self.dry_run or any(p.search(url) for p in self.allow):
            return "log"
        return "abort"

    def record(self, decision: str, method: str, url: str, body: str | None = None) -> None:
        line = f"{datetime.now(timezone.utc).isoformat(timespec='seconds')}\t{decision}\t{method}\t{url}"
        if body and "slides.com" in (urlsplit(url).hostname or ""):
            line += f"\tbody[{len(body)}]={body[:400]!r}"
        with self.log_path.open("a", encoding="utf-8") as log:
            log.write(line + "\n")


def check_download(path: Path, kind: str) -> None:
    """Raise if the file is not what the button promises."""
    if kind == "pdf":
        with path.open("rb") as f:
            if f.read(5) != b"%PDF-":
                raise ValueError(f"{path.name} is not a PDF")
        return
    with zipfile.ZipFile(path) as z:
        if not any(n.endswith("index.html") for n in z.namelist()):
            raise ValueError(f"{path.name} has no index.html")


# --- browser side ----------------------------------------------------------------------------

LIST_JS = """() => [...document.querySelectorAll('li.deck[data-slug]')].map(li => ({
    slug: li.dataset.slug, deck_id: li.dataset.id, created_at: li.dataset.createdAt,
    title: (li.querySelector('h2.deck-title') || li).innerText.trim() }))"""


def list_decks(page, username: str, settle_rounds: int = 3) -> list[DeckEntry]:
    """All decks on the account page; scrolls until the count stops growing."""
    page.goto(f"{SITE}/{username}", wait_until="networkidle")
    seen, stable = -1, 0
    while stable < settle_rounds:
        page.locator("li.deck[data-slug]").last.scroll_into_view_if_needed()
        page.mouse.wheel(0, 4000)
        page.wait_for_timeout(800)
        count = page.locator("li.deck[data-slug]").count()
        stable = stable + 1 if count == seen else 0
        seen = count
    return [DeckEntry(**row) for row in page.evaluate(LIST_JS)]


class Downloads:
    """Browser-level download handling through CDP; Playwright's own events are unreliable over CDP."""

    def __init__(self, browser, folder: Path):
        self.folder = folder
        self.folder.mkdir(parents=True, exist_ok=True)
        self.cdp = browser.new_browser_cdp_session()
        self.started: dict[str, str] = {}
        self.finished: dict[str, str] = {}
        self.cdp.on("Browser.downloadWillBegin", lambda e: self.started.__setitem__(e["guid"], e["suggestedFilename"]))
        self.cdp.on("Browser.downloadProgress", self._progress)
        self.cdp.send("Browser.setDownloadBehavior",
                      {"behavior": "allowAndName", "downloadPath": str(folder), "eventsEnabled": True})

    def _progress(self, event) -> None:
        if event["state"] in ("completed", "canceled"):
            self.finished[event["guid"]] = event["state"]

    def wait(self, page, before: set[str], timeout_s: float) -> tuple[str, str]:
        """Wait for one new download started after `before`; return (guid, suggested name)."""
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            new = [g for g in self.started if g not in before]
            if new and new[0] in self.finished:
                guid = new[0]
                if self.finished[guid] != "completed":
                    raise RuntimeError(f"download {self.started[guid]} was cancelled")
                return guid, self.started[guid]
            page.wait_for_timeout(500)
        raise TimeoutError(f"no finished download after {timeout_s:.0f} s")


def export_deck(page, downloads: Downloads, deck: DeckEntry, inbox: Path, manifest: Manifest,
                username: str, timeout_s: float, log) -> None:
    page.goto(f"{SITE}/{username}/{deck.slug}/edit", wait_until="domcontentloaded")
    export = page.locator('[data-tooltip="Export"]').first
    export.wait_for(state="visible", timeout=60_000)
    page.wait_for_timeout(1500)
    export.click()
    for kind, selector in KINDS.items():
        if manifest.done(deck.slug, kind):
            log(f"  {kind}: already done")
            continue
        button = page.locator(selector).first
        button.wait_for(state="visible", timeout=30_000)
        before = set(downloads.started)
        button.click()
        guid, name = downloads.wait(page, before, timeout_s)
        target = inbox / f"{deck.slug}.{kind}"
        os.replace(downloads.folder / guid, target)
        check_download(target, kind)
        manifest.mark(deck.slug, kind, target)
        log(f"  {kind}: {target.name} ({target.stat().st_size / 1e6:.1f} MB, served as {name!r})")


def run(cdp_url: str, inbox: Path, username: str, only: list[str], exclude: list[str],
        allow: list[str], dry_run: bool, pause_s: float, timeout_s: float, log=print) -> int:
    from playwright.sync_api import sync_playwright

    inbox.mkdir(parents=True, exist_ok=True)
    manifest = Manifest(inbox / "manifest.json")
    guard = RequestGuard(inbox / "requests.log", allow, dry_run)

    def route(route, request):
        decision = guard.decide(request.method, request.url)
        if decision != "pass":
            guard.record(decision, request.method, request.url, request.post_data)
        route.abort() if decision == "abort" else route.continue_()

    failures = 0
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(cdp_url)
        page = browser.contexts[0].new_page()
        try:
            page.route("**/*", route)
            decks = list_decks(page, username)
            _write_json(inbox / "decks.json", [asdict(d) | {"folder": d.folder_name} for d in decks])
            log(f"{len(decks)} decks listed on {SITE}/{username}")
            todo = [d for d in decks if (not only or d.slug in only) and d.slug not in exclude]
            downloads = Downloads(browser, inbox / ".partial")
            for i, deck in enumerate(todo, 1):
                if all(manifest.done(deck.slug, k) for k in KINDS):
                    continue
                log(f"[{i}/{len(todo)}] {deck.slug}  ({deck.title})")
                try:
                    export_deck(page, downloads, deck, inbox, manifest, username, timeout_s, log)
                except Exception as exc:  # keep going: the manifest makes the next run retry it
                    failures += 1
                    log(f"  FAILED: {exc}")
                if i < len(todo):
                    page.goto("about:blank")
                    time.sleep(pause_s)
        finally:
            page.close()
    return failures
