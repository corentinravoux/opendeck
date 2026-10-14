"""The only writer (and reader) of a deck's index.html.

The page is self-contained: it opens offline in any browser, through the runtime copied in
lib/. Metadata sits in a JSON script; the slides sit between two marker comments, so they
can be read back without parsing the page.
"""

from __future__ import annotations

import html
import json

from .. import __version__
from .meta import DeckMeta

START, END = "<!-- od:slides:start -->", "<!-- od:slides:end -->"
_META_OPEN = '<script type="application/json" id="opendeck-meta">'


def render(meta: DeckMeta, slides_html: str) -> str:
    meta_json = json.dumps(meta.to_dict(), ensure_ascii=False, indent=1).replace("</", "<\\/")
    return f"""<!DOCTYPE html>
<html lang="en" class="od-root">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="opendeck {__version__}">
<title>{html.escape(meta.title)}</title>
<link rel="stylesheet" href="lib/opendeck.css">
{_META_OPEN}
{meta_json}
</script>
</head>
<body class="od-deck theme-font-{meta.theme_font} theme-color-{meta.theme_color}">
<div class="reveal"><div class="slides">
{START}
{slides_html.strip()}
{END}
</div></div>
<script src="lib/opendeck.js"></script>
</body>
</html>
"""


def read(page: str) -> tuple[DeckMeta, str]:
    """(metadata, slides HTML) of a page written by render()."""
    try:
        a = page.index(_META_OPEN) + len(_META_OPEN)
        b = page.index("</script>", a)
        s = page.index(START) + len(START)
        e = page.index(END, s)
    except ValueError:
        raise ValueError("not an opendeck page (metadata or slide markers missing)") from None
    meta = DeckMeta.from_dict(json.loads(page[a:b]))
    return meta, page[s:e].strip()
