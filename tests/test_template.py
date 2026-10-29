import pytest
from conftest import SLIDES, export_page

from opendeck.deck import template
from opendeck.deck.meta import DeckMeta
from opendeck.importer.htmlregion import page_title, slconfig, slides_region


def test_slides_region_is_verbatim():
    page = export_page()
    s, e = slides_region(page)
    assert page[s:e] == SLIDES


def test_slides_region_handles_nested_divs():
    page = '<div class="reveal"><div class="slides"><section><div><div>x</div></div></section></div></div>'
    s, e = slides_region(page)
    assert page[s:e] == "<section><div><div>x</div></div></section>"


def test_slides_region_missing():
    with pytest.raises(ValueError):
        slides_region("<html><body>nothing</body></html>")


def test_slconfig_and_title():
    page = export_page(deck_id=7)
    assert slconfig(page)["deck"]["id"] == 7
    assert page_title(page) == "Démo deck"


def test_render_read_roundtrip():
    meta = DeckMeta(title="A </script> title & more", notes={"s1": "note</script>"})
    page = template.render(meta, "<section>é</section>")
    back, slides = template.read(page)
    assert back == meta and slides == "<section>é</section>"
    assert page.count("</script>") == 2  # meta script + runtime script, none injected


def test_read_rejects_foreign_pages():
    with pytest.raises(ValueError, match="not an opendeck page"):
        template.read(export_page())
