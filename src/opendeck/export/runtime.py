"""The deck runtime (lib/opendeck.js, lib/opendeck.css, lib/fonts/) copied into each deck."""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from pathlib import Path

BUILD = Path(__file__).resolve().parents[1] / "_web" / "runtime"


def build_dir() -> Path:
    if not (BUILD / "opendeck.js").is_file():
        raise FileNotFoundError(f"runtime not built: run `npm run build` in web/ (expected {BUILD})")
    return BUILD


def build_id() -> str:
    h = hashlib.sha256()
    for name in ("opendeck.js", "opendeck.css"):
        h.update((build_dir() / name).read_bytes())
    return h.hexdigest()[:16]


def install(deck_dir: Path, force: bool = False) -> bool:
    """Copy the runtime into <deck>/lib unless it is already this build. True if copied."""
    lib = deck_dir / "lib"
    version = build_id()
    if not force and (lib / "VERSION").is_file() and (lib / "VERSION").read_text().strip() == version:
        return False
    src = build_dir()
    tmp = Path(tempfile.mkdtemp(prefix=".lib-", dir=deck_dir))
    try:
        shutil.copy2(src / "opendeck.js", tmp / "opendeck.js")
        shutil.copy2(src / "opendeck.css", tmp / "opendeck.css")
        (tmp / "fonts").mkdir()
        for font in (src / "fonts").iterdir():
            # KaTeX lists .woff/.ttf fallbacks that browsers never fetch once .woff2 loads
            if font.suffix == ".woff2" or not font.name.startswith("KaTeX_"):
                shutil.copy2(font, tmp / "fonts" / font.name)
        (tmp / "VERSION").write_text(version + "\n")
        old = deck_dir / ".lib-old"
        if lib.exists():
            os.replace(lib, old)
        os.replace(tmp, lib)
        shutil.rmtree(old, ignore_errors=True)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return True
