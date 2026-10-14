"""Import a slides.com HTML export (zip or unpacked folder) as an opendeck deck.

The export holds index.html, lib/ (slides.com's runtime) and <slug>/ (the media). This importer:

1. cuts the slides out of index.html verbatim;
2. maps SLConfig onto our metadata;
3. stores each media file under media/<hash>.<ext> and rewrites the references;
4. turns lazy <img data-src> into src;
5. writes the page with our template.

It never opens anything under lib/: that is slides.com code (see CLEANROOM.md).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from ..deck import media, template, versioning
from ..deck.meta import DeckMeta
from .htmlregion import page_title, slconfig, slides_region

FORBIDDEN_DIR = "lib"
KNOWN_BLOCKS = {"text", "math", "image", "shape", "line", "drawing", "group",
                "code", "table", "iframe", "video", "chart"}
RUNTIME_CLASSES = {"present", "past", "future", "visible", "is-focused", "is-empty", "has-preview"}


class ExportSource:
    """Read-only view of an export, as a zip or a folder. Refuses to read lib/."""

    def __init__(self, path: Path):
        self.path = path
        self.zip = zipfile.ZipFile(path) if path.is_file() else None
        names = self._names()
        index = sorted((n for n in names if n.rsplit("/", 1)[-1] == "index.html"), key=len)
        if not index:
            raise ValueError(f"{path}: no index.html")
        self.root = index[0][: -len("index.html")]

    def _names(self) -> list[str]:
        if self.zip:
            return [n for n in self.zip.namelist() if not n.endswith("/")]
        return [p.relative_to(self.path).as_posix() for p in self.path.rglob("*") if p.is_file()]

    def _check(self, rel: str) -> None:
        if rel.split("/", 1)[0] == FORBIDDEN_DIR:
            raise PermissionError(f"refusing to read slides.com runtime file {rel}")

    def read(self, rel: str) -> bytes:
        self._check(rel)
        if self.zip:
            return self.zip.read(self.root + rel)
        return (self.path / self.root / rel).read_bytes()

    def files_under(self, folder: str) -> list[str]:
        """Relative names of the files under <root>/<folder>/, never under lib/."""
        self._check(folder)
        prefix = f"{self.root}{folder}/"
        return sorted(n[len(self.root):] for n in self._names() if n.startswith(prefix))


@dataclass
class ImportReport:
    folder: str
    slides: int = 0
    blocks: dict[str, int] = field(default_factory=dict)
    media_files: int = 0
    media_bytes: int = 0
    remote_refs: list[str] = field(default_factory=list)
    missing_refs: list[str] = field(default_factory=list)
    unknown_blocks: list[str] = field(default_factory=list)
    runtime_classes: int = 0
    features: dict[str, int] = field(default_factory=dict)


_REF = re.compile(r"""(?:\b(?:src|data-src|data-background-image|href)=["']|url\(["']?)([^"')\s]+)""")


def _rewrite_media(region: str, mapping: dict[str, str]) -> str:
    for old, new in mapping.items():
        region = re.sub(r"(?<=[\"'(])" + re.escape(old) + r"(?=[\"')])", new, region)
    return region


def _unlazy_images(region: str) -> str:
    def fix(m: re.Match) -> str:
        tag = m.group(0).replace(' data-lazy-loaded=""', "")
        return tag if re.search(r"\ssrc=", tag) else tag.replace(" data-src=", " src=", 1)
    return re.sub(r"<img\b[^>]*>", fix, region)


def _inspect(region: str, report: ImportReport) -> None:
    report.slides = len(re.findall(r"<section\b", region))
    blocks = Counter(re.findall(r'data-block-type="([a-z-]+)"', region))
    report.blocks = dict(blocks.most_common())
    report.unknown_blocks = sorted(set(blocks) - KNOWN_BLOCKS)
    for ref in _REF.findall(region):
        if ref.startswith(("http://", "https://", "//")):
            report.remote_refs.append(ref)
        elif not ref.startswith(("media/", "data:", "#")):
            report.missing_refs.append(ref)
    classes = (c for attr in re.findall(r'class="([^"]*)"', region) for c in attr.split())
    report.runtime_classes = sum(c in RUNTIME_CLASSES for c in classes)
    report.features = {
        "fragments": len(re.findall(r'class="[^"]*\bfragment\b', region)),
        "auto_animate": region.count("data-auto-animate"),
        "background_image": region.count("data-background-image"),
        "background_color": region.count("data-background-color"),
        "inline_math": region.count("\\("),
        "vertical_stacks": len(re.findall(r"<section\b[^>]*>\s*<section\b", region)),
    }


def _hardlink_or_copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.unlink(missing_ok=True)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copyfile(src, dst)


def folder_name_for(meta: DeckMeta, listing: dict | None = None) -> str:
    """YYYY-MM_<slug>, from the deck listing's creation date, else SLConfig's published_at."""
    slug = meta.source.get("slug") or re.sub(r"[^a-z0-9-]+", "-", meta.title.lower()).strip("-")
    if listing and listing.get("folder"):
        return listing["folder"]
    published = meta.source.get("slconfig", {}).get("deck", {}).get("published_at") or ""
    try:
        stamp = datetime.fromisoformat(published.replace("Z", "+00:00")).strftime("%Y-%m")
    except ValueError:
        stamp = "0000-00"
    return f"{stamp}_{slug}"


def import_export(src: Path, decks_root: Path, *, folder: str | None = None,
                  listing: dict | None = None, reference_pdf: Path | None = None,
                  mirror: Path | None = None, force: bool = False) -> ImportReport:
    source = ExportSource(src)
    page = source.read("index.html").decode("utf-8")
    sl = slconfig(page)
    meta = DeckMeta.from_slconfig(sl, title=page_title(page))
    start, end = slides_region(page)
    region = page[start:end]

    name = folder or folder_name_for(meta, listing)
    deck_dir = decks_root / name
    if deck_dir.exists():
        old_meta, _ = template.read((deck_dir / "index.html").read_text(encoding="utf-8"))
        same = old_meta.source.get("id") == meta.source.get("id")
        if same and not force:
            raise FileExistsError(f"{deck_dir} already holds this deck; use --force to re-import")
        if not same:
            n = 2
            while (decks_root / f"{name}-{n}").exists():
                n += 1
            name, deck_dir = f"{name}-{n}", decks_root / f"{name}-{n}"
    deck_dir.mkdir(parents=True, exist_ok=True)
    if mirror and force and (deck_dir / "index.html").exists():
        versioning.commit(mirror, deck_dir, f"{name}: before re-import")

    report = ImportReport(folder=name)
    mapping: dict[str, str] = {}
    slug = meta.source.get("slug") or ""
    for rel in source.files_under(slug) if slug else []:
        data = source.read(rel)
        mapping[rel] = media.store(deck_dir, data, rel)[0]
        report.media_files += 1
        report.media_bytes += len(data)

    region = _unlazy_images(_rewrite_media(region, mapping))
    _inspect(region, report)
    (deck_dir / "index.html").write_text(template.render(meta, region), encoding="utf-8")

    state = deck_dir / ".opendeck"
    state.mkdir(exist_ok=True)
    if reference_pdf and reference_pdf.is_file():
        _hardlink_or_copy(reference_pdf, state / "reference" / "slidescom.pdf")
    (state / "import-report.json").write_text(
        json.dumps(report.__dict__, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if mirror:
        versioning.commit(mirror, deck_dir, f"{name}: import from slides.com")
    return report
