"""PDF export: the deck's own page in print mode, printed by the system Chrome."""

from __future__ import annotations

import os
from pathlib import Path

from ..deck import template
from . import runtime


def export_pdf(deck_dir: Path, out: Path, timeout_s: float = 180.0) -> Path:
    from playwright.sync_api import sync_playwright

    runtime.install(deck_dir)
    meta, _ = template.read((deck_dir / "index.html").read_text(encoding="utf-8"))
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(f".{out.name}.part")
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        try:
            page = browser.new_page(viewport={"width": meta.width, "height": meta.height})
            page.goto((deck_dir / "index.html").as_uri() + "?print-pdf")
            page.wait_for_selector("html[data-od-ready]", state="attached", timeout=timeout_s * 1000)
            page.pdf(path=str(tmp), prefer_css_page_size=True, print_background=True)
        finally:
            browser.close()
    os.replace(tmp, out)
    return out
