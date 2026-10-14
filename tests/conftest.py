import json
import os
import zipfile
from pathlib import Path

import pytest

# Real slides.com exports (optional): set OPENDECK_EXAMPLES to a folder holding unpacked
# slides_<slug>/ exports; the tests that need them are skipped otherwise.
EXAMPLES = Path(os.environ.get("OPENDECK_EXAMPLES", "/nonexistent"))
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32

SLIDES = """
			<section data-id="aaa111bbb222"><div class="sl-block" data-block-type="text" style="height: auto; width: 600px; left: 40px; top: 40px;" data-block-id="t1"><div class="sl-block-content" data-placeholder-tag="p" style="z-index: 10;"><p>Croissance « fσ<sub>8</sub> » — éàü</p></div></div>
<div class="sl-block" data-block-type="math" style="width: auto; height: auto; left: 100px; top: 200px;" data-block-id="m1"><div class="sl-block-content notranslate" style="z-index: 11; font-size: 60%;"><div class="math-input">\\lambda_{\\mathrm{obs}} = (1+z)\\lambda_\\alpha</div></div></div>
<div class="sl-block" data-block-type="image" style="width: 200px; height: 100px; left: 500px; top: 300px;" data-block-id="i1"><div class="sl-block-content" style="z-index: 12;"><img class="" data-natural-width="20" data-natural-height="10" data-lazy-loaded="" data-src="demo-deck/abc.png"></div></div></section>
			<section data-id="ccc333ddd444" data-background-color="#000000"><div class="sl-block" data-block-type="image" style="width: 200px; height: 100px; left: 0px; top: 0px;" data-block-id="i2"><div class="sl-block-content" style="z-index: 10;"><img data-src="demo-deck/abc.png"></div></div></section>
"""


def export_page(slug: str = "demo-deck", deck_id: int = 42) -> str:
    sl = {"deck": {"id": deck_id, "slug": slug, "title": "Démo deck", "width": 1024, "height": 576,
                   "margin": 0.0, "transition": "fade", "background_transition": "fade",
                   "theme_font": "montserrat", "theme_color": "white-blue", "slide_number": True,
                   "published_at": "2024-12-06T09:09:11.994Z", "version": 2, "notes": {}}}
    return f"""<!DOCTYPE html>
	<html class="sl-root decks export offline loaded">
	<head><meta charset="utf-8"><title>Démo deck</title><link rel="stylesheet" type="text/css" href="lib/offline-v2.css"></head>
	<body class="reveal-viewport theme-font-montserrat theme-color-white-blue">
		<div class="reveal">
			<div class="slides">{SLIDES}</div>
		</div>
		<script>
			var SLConfig = {json.dumps(sl)};

			SLConfig.fonts_url = 'lib/fonts/';
		</script>
		<script src="lib/reveal.js"></script>
	</body>
</html>
"""


@pytest.fixture
def make_export(tmp_path):
    """Build a slides.com-style export: as a zip (default) or an unpacked folder."""

    def build(as_zip: bool = True, slug: str = "demo-deck", deck_id: int = 42) -> Path:
        files = {
            "index.html": export_page(slug, deck_id).encode(),
            "lib/offline.js": b"// slides.com runtime: must never be read",
            f"{slug}/abc.png": PNG,
        }
        if as_zip:
            path = tmp_path / f"{slug}-{deck_id}.zip"
            with zipfile.ZipFile(path, "w") as z:
                for name, data in files.items():
                    z.writestr(name, data)
            return path
        root = tmp_path / f"slides_{slug}-{deck_id}"
        for name, data in files.items():
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).write_bytes(data)
        return root

    return build


@pytest.fixture
def decks_root(tmp_path):
    root = tmp_path / "Dossier é x" / "decks"
    root.mkdir(parents=True)
    return root
