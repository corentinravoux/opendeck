"""The decks folder: listing, reading, per-deck state (remembered export destinations)."""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from . import template, versioning
from .meta import DeckMeta

STATE = Path(".opendeck") / "state.json"
MAX_REMEMBERED = 8


@dataclass
class DeckInfo:
    name: str
    title: str
    slides: int
    width: int
    height: int
    modified: str
    theme_font: str
    theme_color: str
    first: str  # HTML of the first slide, for the deck-list thumbnail


def list_decks(decks_root: Path) -> list[DeckInfo]:
    """Every deck under decks_root, newest folder name first (names start with YYYY-MM)."""
    decks = []
    for index in decks_root.glob("*/index.html"):
        folder = index.parent
        if folder.name.startswith(("_", ".")):
            continue
        try:
            meta, slides = template.read(index.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        modified = datetime.fromtimestamp(index.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
        first = re.search(r"<section\b.*?</section>", slides, re.S)
        decks.append(DeckInfo(folder.name, meta.title, len(re.findall(r"<section\b", slides)),
                              meta.width, meta.height, modified, meta.theme_font, meta.theme_color,
                              first.group(0) if first else ""))
    return sorted(decks, key=lambda d: d.name, reverse=True)


def etag(page: str) -> str:
    return hashlib.sha256(page.encode("utf-8")).hexdigest()[:16]


def read(deck: Path) -> dict:
    page = (deck / "index.html").read_text(encoding="utf-8")
    meta, slides = template.read(page)
    return {"name": deck.name, "meta": meta.to_dict(), "slides": slides, "etag": etag(page)}


def _state(deck: Path) -> dict:
    path = deck / STATE
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def _write_state(deck: Path, state: dict) -> None:
    path = deck / STATE
    path.parent.mkdir(exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def remembered_exports(deck: Path) -> list[dict]:
    return _state(deck).get("exports", [])


def remember_export(deck: Path, kind: str, folder: Path, name: str, as_zip: bool = False) -> None:
    """Record an export destination, most recent first, without duplicates."""
    state = _state(deck)
    entry = {"kind": kind, "dir": str(folder), "name": name, "zip": as_zip,
             "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    same = lambda e: (e["kind"], e["dir"], e["name"], e.get("zip", False)) == (kind, str(folder), name, as_zip)
    state["exports"] = [entry] + [e for e in state.get("exports", []) if not same(e)][: MAX_REMEMBERED - 1]
    _write_state(deck, state)


def as_dicts(decks: list[DeckInfo]) -> list[dict]:
    return [asdict(d) for d in decks]


class Conflict(Exception):
    """The deck changed on disk since the client loaded it."""


MAX_SLIDES_BYTES = 64 * 1024 * 1024


def save(deck: Path, slides: str, expected_etag: str, meta: dict | None = None) -> str:
    """Write the deck's slides (and optionally its metadata) atomically; returns the new etag."""
    index = deck / "index.html"
    page = index.read_text(encoding="utf-8")
    if etag(page) != expected_etag:
        raise Conflict(deck.name)
    if len(slides.encode("utf-8")) > MAX_SLIDES_BYTES or "<section" not in slides:
        raise ValueError("slides must be non-empty HTML with at least one <section>")
    old_meta, _ = template.read(page)
    new_meta = DeckMeta.from_dict(old_meta.to_dict() | (meta or {}) | {"format": old_meta.format})
    new_page = template.render(new_meta, slides)
    tmp = index.with_name(".index.html.tmp")
    tmp.write_text(new_page, encoding="utf-8")
    os.replace(tmp, index)
    return etag(new_page)


class Historian:
    """Commits saved decks to the history mirror: at most every `interval_s` per deck,
    immediately when asked, and for everything pending on flush (server shutdown)."""

    def __init__(self, mirror: Path, interval_s: float = 600.0):
        self.mirror = mirror
        self.interval_s = interval_s
        self.last: dict[str, float] = {}
        self.pending: dict[str, Path] = {}

    def saved(self, deck: Path, now: float, force: bool = False) -> bool:
        self.pending[deck.name] = deck
        if force or now - self.last.get(deck.name, float("-inf")) >= self.interval_s:
            return self.commit(deck.name, now)
        return False

    def commit(self, name: str, now: float) -> bool:
        deck = self.pending.pop(name, None)
        if deck is None:
            return False
        self.last[name] = now
        return versioning.commit(self.mirror, deck, f"{name}: edit")

    def flush(self, now: float) -> None:
        for name in list(self.pending):
            self.commit(name, now)

    def renamed(self, old: str, deck: Path) -> None:
        """Deck `old` now lives at `deck`: what was pending for it is pending under its new name."""
        if self.pending.pop(old, None) is not None:
            self.pending[deck.name] = deck
        if old in self.last:
            self.last[deck.name] = self.last.pop(old)


def _slug(title: str) -> str:
    """The title in lowercase ASCII letters, digits and dashes; empty if nothing is left."""
    import unicodedata

    ascii_ = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_.lower()).strip("-")[:60]


def slugify(title: str) -> str:
    return _slug(title) or "deck"


def _new_folder(decks_root: Path, title: str, today: datetime | None) -> Path:
    """A free folder path YYYY-MM_<slug> (then -2, -3, ...) for a new deck; not created."""
    base = f"{(today or datetime.now()):%Y-%m}_{slugify(title)}"
    name, n = base, 2
    while (decks_root / name).exists():
        name, n = f"{base}-{n}", n + 1
    return decks_root / name


def create(decks_root: Path, title: str, today: datetime | None = None) -> Path:
    """A new deck folder YYYY-MM_<slug> with one title slide (1024x576, the decks' usual theme)."""
    import secrets

    deck = _new_folder(decks_root, title, today)
    (deck / "media").mkdir(parents=True)
    meta = DeckMeta(title=title.strip() or "Untitled")
    sid, bid = secrets.token_hex(12), secrets.token_hex(6)
    from html import escape

    slide = (f'<section data-id="{sid}"><div class="sl-block" data-block-type="text" '
             f'style="height: auto; width: 864px; left: 80px; top: 230px;" data-block-id="{bid}">'
             f'<div class="sl-block-content" data-placeholder-tag="h1" data-placeholder-text="Title" style="z-index: 10;">'
             f"<h2>{escape(meta.title)}</h2></div></div></section>")
    (deck / "index.html").write_text(template.render(meta, slide), encoding="utf-8")
    return deck


def duplicate(decks_root: Path, source: Path, title: str, today: datetime | None = None) -> Path:
    """A copy of deck `source` under a new title, filed under this month: its slides, its images
    (hard-linked when possible: media files are content-addressed and never rewritten) and its
    runtime. Its export destinations, reference PDF and history stay with the original."""
    import shutil

    deck = _new_folder(decks_root, title, today)
    tmp = deck.with_name(f".{deck.name}.tmp")
    try:
        (tmp / "media").mkdir(parents=True)
        for f in (source / "media").iterdir() if (source / "media").is_dir() else ():
            if f.is_file():
                try:
                    os.link(f, tmp / "media" / f.name)
                except OSError:
                    shutil.copy2(f, tmp / "media" / f.name)
        if (source / "lib").is_dir():
            shutil.copytree(source / "lib", tmp / "lib")
        meta, slides = template.read((source / "index.html").read_text(encoding="utf-8"))
        meta = DeckMeta.from_dict(meta.to_dict() | {"title": title.strip() or meta.title, "format": meta.format})
        (tmp / "index.html").write_text(template.render(meta, slides), encoding="utf-8")
        os.replace(tmp, deck)
    finally:
        if tmp.exists():
            shutil.rmtree(tmp)
    return deck


def trash(decks_root: Path, deck: Path) -> Path:
    """Move a deck into <decks_root>/.trash/ (nothing is deleted); returns its new place."""
    bin_ = decks_root / ".trash"
    bin_.mkdir(exist_ok=True)
    target = bin_ / f"{deck.name}_{datetime.now():%Y%m%d-%H%M%S}"
    os.replace(deck, target)
    return target


_MONTH = re.compile(r"^(\d{4}-\d{2})_")


def _write_page(index: Path, page: str) -> None:
    tmp = index.with_name(".index.html.tmp")
    tmp.write_text(page, encoding="utf-8")
    os.replace(tmp, index)


def rename(decks_root: Path, deck: Path, title: str, mirror: Path | None = None) -> Path:
    """Give `deck` a new title, and its folder the matching name: the same YYYY-MM prefix, then
    the title's slug (-2, -3, ... when taken by another deck or by another deck's history). The
    folder stays when the slug does not change. With `mirror`, the deck's history folder moves
    along (git mv), so its past versions stay attached. Returns the deck's folder.

    If anything fails, the deck keeps its old title and folder (and the mirror its old state)."""
    title = title.strip()
    slug = _slug(title)
    if not slug:
        raise ValueError("the title needs at least one Latin letter or digit, to name the deck's folder")
    month = _MONTH.match(deck.name)
    base = f"{month.group(1) if month else f'{datetime.now():%Y-%m}'}_{slug}"
    if deck.name == base or re.fullmatch(re.escape(base) + r"-\d+", deck.name):
        name = deck.name  # same slug: keep the folder
    else:
        taken = lambda n: (decks_root / n).exists() or (mirror is not None and (mirror / n).exists())
        name, n = base, 2
        while taken(name):
            name, n = f"{base}-{n}", n + 1
    target = decks_root / name

    index = deck / "index.html"
    old_page = index.read_text(encoding="utf-8")
    meta, slides = template.read(old_page)
    meta = DeckMeta.from_dict(meta.to_dict() | {"title": title, "format": meta.format})
    _write_page(index, template.render(meta, slides))
    try:
        if target != deck:
            os.rename(deck, target)
            try:
                if mirror is not None:
                    versioning.rename(mirror, deck.name, name, target)
            except BaseException:
                os.rename(target, deck)
                raise
        elif mirror is not None and (mirror / deck.name / "index.html").is_file():
            versioning.commit(mirror, deck, f"{deck.name}: rename")
    except BaseException:
        _write_page(index, old_page)
        raise
    return target
