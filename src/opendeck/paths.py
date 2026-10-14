"""Validation of deck names and export destinations."""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from .config import Config

_DECK_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$")


def nfc(path: Path | str) -> Path:
    return Path(unicodedata.normalize("NFC", str(path)))


def deck_dir(config: Config, name: str) -> Path:
    """The folder of deck `name`; raises if the name is not a plain folder name or no deck is there."""
    if not _DECK_NAME.match(name) or name.startswith(("_", ".")):
        raise ValueError(f"invalid deck name {name!r}")
    path = config.decks_root / name
    if not (path / "index.html").is_file():
        raise FileNotFoundError(f"no deck {name!r}")
    return path


def export_destination(config: Config, out: Path | str) -> Path:
    """Resolve an export folder; it must lie under export_root and outside decks_root."""
    target = nfc(Path(out).expanduser().resolve())
    root = nfc(config.export_root.expanduser().resolve())
    decks = nfc(config.decks_root.expanduser().resolve())
    if not target.is_relative_to(root):
        raise PermissionError(f"exports must go inside {root}")
    if target == decks or target.is_relative_to(decks):
        raise PermissionError(f"exports must not go inside the decks folder {decks}")
    return target


def safe_filename(name: str) -> str:
    """A file or folder name for an export: no path separators, no leading dot."""
    name = unicodedata.normalize("NFC", name).strip().replace("/", "-").replace("\\", "-")
    name = name.lstrip(".")
    if not name:
        raise ValueError("empty export name")
    return name
