"""Media files of a deck: content-addressed names under <deck>/media/."""

from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path

MEDIA_DIR = "media"
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
