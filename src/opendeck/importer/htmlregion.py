"""Locate pieces of an exported page without re-serialising anything.

The slides region is cut out of the page verbatim, so text and attributes reach the deck
byte for byte.
"""

from __future__ import annotations

import json
import re
from html import unescape
from html.parser import HTMLParser


class _SlidesFinder(HTMLParser):
    """Finds the inner extent of the first <div class="slides">."""

    def __init__(self, line_starts: list[int]):
        super().__init__(convert_charrefs=False)
        self.line_starts = line_starts
        self.start: int | None = None
        self.end: int | None = None
        self.depth = 0

    def _offset(self) -> int:
        line, col = self.getpos()
        return self.line_starts[line - 1] + col

    def handle_starttag(self, tag, attrs):
        if tag != "div" or self.end is not None:
            return
        if self.start is not None:
            self.depth += 1
        elif "slides" in (dict(attrs).get("class") or "").split():
            self.start = self._offset() + len(self.get_starttag_text() or "")

    def handle_endtag(self, tag):
        if tag != "div" or self.start is None or self.end is not None:
            return
        if self.depth == 0:
            self.end = self._offset()
        else:
            self.depth -= 1


def slides_region(html: str) -> tuple[int, int]:
    """(start, end) offsets of the inner HTML of the first div.slides."""
    line_starts = [0] + [m.end() for m in re.finditer("\n", html)]
    finder = _SlidesFinder(line_starts)
    finder.feed(html)
    finder.close()
    if finder.start is None or finder.end is None:
        raise ValueError("no <div class=\"slides\"> found")
    return finder.start, finder.end


_SLCONFIG = re.compile(r"var\s+SLConfig\s*=\s*(\{.*?\});\s*$", re.S | re.M)


def slconfig(html: str) -> dict:
    """The SLConfig object of a slides.com export (empty if absent)."""
    m = _SLCONFIG.search(html)
    return json.loads(m.group(1)) if m else {}


def page_title(html: str) -> str:
    m = re.search(r"<title>(.*?)</title>", html, re.S | re.I)
    return unescape(m.group(1).strip()) if m else ""
