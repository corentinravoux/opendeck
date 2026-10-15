"""HTML export: index.html + lib/ + only the media the slides use, as a folder or a zip."""

from __future__ import annotations

import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

from . import runtime

# any quoted media path: src, poster, data-print, data-background-image, url(...)
_MEDIA_REF = re.compile(r"""(?<=["'(])media/[A-Za-z0-9_.-]+(?=["')])""")


def referenced_media(page: str) -> list[str]:
    return sorted(set(_MEDIA_REF.findall(page)))


def _files(deck_dir: Path) -> list[tuple[Path, str]]:
    """(source file, archive name) of everything the exported deck needs."""
    page = (deck_dir / "index.html").read_text(encoding="utf-8")
    files = [(deck_dir / "index.html", "index.html")]
    files += [(p, p.relative_to(deck_dir).as_posix()) for p in sorted((deck_dir / "lib").rglob("*")) if p.is_file()]
    for rel in referenced_media(page):
        if (deck_dir / rel).is_file():
            files.append((deck_dir / rel, rel))
    return files


def export_html(deck_dir: Path, out_dir: Path, name: str, as_zip: bool = False, overwrite: bool = False) -> Path:
    """Write <out_dir>/<name>/ (or <out_dir>/<name>.zip). Returns the path written."""
    runtime.install(deck_dir)
    target = out_dir / (f"{name}.zip" if as_zip else name)
    if target.exists() and not overwrite:
        raise FileExistsError(f"{target} exists (use overwrite)")
    out_dir.mkdir(parents=True, exist_ok=True)
    files = _files(deck_dir)
    if as_zip:
        tmp = target.with_name(f".{target.name}.part")
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
            for src, arc in files:
                z.write(src, f"{name}/{arc}")
        os.replace(tmp, target)
        return target
    staging = Path(tempfile.mkdtemp(prefix=f".{name}-", dir=out_dir))
    try:
        for src, arc in files:
            (staging / arc).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, staging / arc)
        if target.exists():
            shutil.rmtree(target)
        os.replace(staging, target)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return target


_MIME = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml",
         "avif": "image/avif", "webm": "video/webm", "mp4": "video/mp4",
         "woff2": "font/woff2", "woff": "font/woff", "ttf": "font/ttf"}


def _data_uri(path: Path) -> str:
    import base64

    mime = _MIME.get(path.suffix.lstrip(".").lower(), "application/octet-stream")
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def export_single(deck_dir: Path, out_dir: Path, name: str, overwrite: bool = False) -> Path:
    """One self-contained <name>.html: CSS, fonts, script, images and videos inlined (it can be large:
    every video is in it, base64-encoded, along with its poster and print images)."""
    runtime.install(deck_dir)
    target = out_dir / f"{name}.html"
    if target.exists() and not overwrite:
        raise FileExistsError(f"{target} exists (use overwrite)")
    lib = deck_dir / "lib"
    css = (lib / "opendeck.css").read_text(encoding="utf-8")
    css = re.sub(r"url\((\./)?fonts/([^)]+)\)",
                 lambda m: f"url({_data_uri(lib / 'fonts' / m.group(2))})" if (lib / "fonts" / m.group(2)).is_file() else m.group(0), css)
    js = (lib / "opendeck.js").read_text(encoding="utf-8").replace("</script", "<\\/script")
    page = (deck_dir / "index.html").read_text(encoding="utf-8")
    page = page.replace('<link rel="stylesheet" href="lib/opendeck.css">', f"<style>\n{css}\n</style>", 1)
    page = page.replace('<script src="lib/opendeck.js"></script>', f"<script>\n{js}\n</script>", 1)
    page = _MEDIA_REF.sub(lambda m: _data_uri(deck_dir / m.group(0)) if (deck_dir / m.group(0)).is_file() else m.group(0), page)
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f".{target.name}.part")
    tmp.write_text(page, encoding="utf-8")
    os.replace(tmp, target)
    return target
