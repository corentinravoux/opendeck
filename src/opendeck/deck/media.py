"""Media files of a deck: content-addressed names under <deck>/media/."""

from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path

MEDIA_DIR = "media"
IMAGE_TYPES = {"png", "jpg", "gif", "webp", "svg", "avif"}
HASH_CHARS = 20
_ALIASES = {"jpeg": "jpg", "jpe": "jpg", "tif": "tiff"}


def sniff(data: bytes, name: str = "") -> str:
    """File extension from the magic bytes; the name's suffix is only a fallback."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[4:12] in (b"ftypavif", b"ftypavis"):
        return "avif"
    head = data[:2048].lstrip()
    if head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in head):
        return "svg"
    suffix = Path(name).suffix.lower().lstrip(".")
    return _ALIASES.get(suffix, suffix) or "bin"


def media_name(data: bytes, name: str = "") -> str:
    return f"{hashlib.sha256(data).hexdigest()[:HASH_CHARS]}.{sniff(data, name)}"


def store(deck_dir: Path, data: bytes, name: str = "") -> tuple[str, bool]:
    """Write data under <deck>/media/ unless already there.

    Returns the path relative to the deck folder ("media/<hash>.<ext>") and whether the file
    already existed.
    """
    folder = deck_dir / MEDIA_DIR
    folder.mkdir(parents=True, exist_ok=True)
    rel = f"{MEDIA_DIR}/{media_name(data, name)}"
    target = deck_dir / rel
    if target.exists():
        return rel, True
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".upload-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, target)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return rel, False


def dimensions(path: Path) -> tuple[int | None, int | None]:
    """Pixel size of an image file (None for unreadable or vector files without a size)."""
    if path.suffix == ".svg":
        import re

        head = path.read_text(encoding="utf-8", errors="replace")[:4096]
        vb = re.search(r'viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)"', head)
        return (round(float(vb.group(1))), round(float(vb.group(2)))) if vb else (None, None)
    try:
        from PIL import Image

        with Image.open(path) as img:
            return img.size
    except Exception:
        return None, None


_REL = __import__("re").compile(r"^media/[A-Za-z0-9_.-]+$")


def copy_between(src_deck: Path, dst_deck: Path, rels: list[str]) -> list[str]:
    """Bring media files referenced by pasted content from one deck into another.

    Names are content hashes, so the same name means the same bytes: an existing file is kept.
    Hard links are used when both decks are on one filesystem, a copy otherwise. Returns the
    paths copied; refuses anything that is not a plain media/<file> path.
    """
    import shutil

    done = []
    (dst_deck / MEDIA_DIR).mkdir(parents=True, exist_ok=True)
    for rel in dict.fromkeys(rels):
        if not _REL.match(rel):
            raise ValueError(f"not a media path: {rel!r}")
        src, dst = src_deck / rel, dst_deck / rel
        if dst.exists() or not src.is_file():
            continue
        try:
            os.link(src, dst)
        except OSError:
            shutil.copyfile(src, dst)
        done.append(rel)
    return done


def library(decks_root: Path, titles: dict[str, str]) -> list[dict]:
    """Every image of every deck, newest deck first: {deck, title, src, bytes}."""
    out = []
    for deck in sorted((d for d in decks_root.iterdir() if d.is_dir() and not d.name.startswith(("_", "."))), reverse=True):
        folder = deck / MEDIA_DIR
        if not folder.is_dir():
            continue
        for f in sorted(folder.iterdir()):
            if f.is_file() and f.suffix.lstrip(".") in IMAGE_TYPES:
                out.append({"deck": deck.name, "title": titles.get(deck.name, deck.name),
                            "src": f"{MEDIA_DIR}/{f.name}", "bytes": f.stat().st_size})
    return out


def thumbnail(src: Path, cache: Path, width: int) -> Path:
    """A cached WebP thumbnail of an image, at most `width` px wide (SVGs are served as they are)."""
    if src.suffix == ".svg":
        return src
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / f"{src.stem}-{width}.webp"
    if target.exists():
        return target
    from PIL import Image

    with Image.open(src) as img:
        img.seek(0)
        img = img.convert("RGBA") if img.mode in ("P", "LA", "RGBA") else img.convert("RGB")
        img.thumbnail((width, width * 4))
        tmp = target.with_suffix(".tmp")
        img.save(tmp, "WEBP", quality=80)
    os.replace(tmp, target)
    return target
