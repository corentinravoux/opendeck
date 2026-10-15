"""End-to-end: the editor in Chrome against a server on a temporary copy of a deck."""

import re
import shutil

import pytest

from opendeck.config import Config
from opendeck.deck import template
from opendeck.importer.slidescom import import_export
from opendeck.server.app import WEB

pytestmark = [
    pytest.mark.skipif(not (WEB / "index.html").is_file(), reason="app not built"),
    pytest.mark.skipif(not shutil.which("google-chrome"), reason="no system Chrome"),
]


@pytest.fixture
def running(make_export, decks_root, tmp_path):
    from opendeck.server.thread import ServerThread

    name = import_export(make_export(), decks_root).folder
    config = Config(decks_root=decks_root, export_root=decks_root.parent, mirror_root=tmp_path / "mirror")
    server = ServerThread(config).start()
    yield server, decks_root / name
    server.stop()


def until(predicate, timeout=10.0):
    """Poll until predicate() is true (autosave is asynchronous); fail after `timeout` s."""
    import time

    deadline = time.monotonic() + timeout
    while True:
        try:
            if predicate():
                return
        except Exception:
            pass
        if time.monotonic() > deadline:
            assert predicate(), "condition not met in time"
        time.sleep(0.1)


def ready(page, deck_name):
    """Wait until the editor for deck_name has attached its keyboard and clipboard listeners."""
    page.wait_for_function(f"document.body.dataset.odEditor === {deck_name!r}", timeout=10000)


def slides_of(deck):
    return template.read((deck / "index.html").read_text(encoding="utf-8"))[1]


def block_style(deck, block_id):
    _, slides = template.read((deck / "index.html").read_text(encoding="utf-8"))
    m = re.search(rf'<div class="sl-block"[^>]*data-block-id="{block_id}"[^>]*>', slides)
    return m.group(0) if m else None


def test_drag_autosave_undo_duplicate_delete(running):
    from playwright.sync_api import sync_playwright

    server, deck = running
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{server.url}/#/deck/{deck.name}")
        ready(page, deck.name)
        block = page.locator('.od-canvas-slide .sl-block[data-block-id="t1"]')
        block.wait_for()
        box = block.bounding_box()
        page.mouse.move(box["x"] + 20, box["y"] + 10)
        page.mouse.down()
        page.mouse.move(box["x"] + 70, box["y"] + 60, steps=8)
        page.mouse.up()
        until(lambda: "left: 40px" not in block_style(deck, "t1"))

        page.keyboard.press("Control+z")
        until(lambda: "left: 40px" in block_style(deck, "t1"))

        page.locator('.od-canvas-slide .sl-block[data-block-id="t1"]').click()
        page.keyboard.press("Control+d")
        until(lambda: slides_of(deck).count('data-block-type="text"') == 2)

        page.keyboard.press("Delete")
        until(lambda: slides_of(deck).count('data-block-type="text"') == 1)
        assert errors == []
        browser.close()


def test_marquee_rotate_layers(running):
    from playwright.sync_api import sync_playwright

    server, deck = running
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{server.url}/#/deck/{deck.name}")
        ready(page, deck.name)
        slide = page.locator(".od-canvas-slide .slides > section")
        slide.wait_for()
        s = slide.bounding_box()
        # drag a marquee over the whole slide from an empty corner: selects every top-level block
        page.mouse.move(s["x"] + s["width"] - 3, s["y"] + s["height"] - 3)
        page.mouse.down()
        page.mouse.move(s["x"] + 2, s["y"] + 2, steps=6)
        page.mouse.up()
        page.wait_for_function("document.querySelectorAll('.od-sel').length === 3", timeout=3000)

        # rotate the text block by dragging its handle to the right of its centre
        page.locator('.od-canvas-slide .sl-block[data-block-id="t1"]').click()
        page.wait_for_function("document.querySelectorAll('.od-sel').length === 1", timeout=3000)
        handle = page.locator(".od-rotate").bounding_box()
        box = page.locator(".od-sel").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(handle["x"] + 6, handle["y"] + 6)
        page.mouse.down()
        page.mouse.move(cx + 200, cy, steps=6)
        page.keyboard.down("Shift")
        page.mouse.move(cx + 201, cy + 1)
        page.mouse.up()
        page.keyboard.up("Shift")
        until(lambda: "rotate(90deg)" in slides_of(deck))

        page.keyboard.press("Control+o")
        assert page.locator(".od-layer").count() == 3
        assert errors == []
        browser.close()


DROP_JS = """async ([b64, mode]) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const file = new File([bytes], mode === 'drop' ? 'Figure é.png' : 'image.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  if (mode === 'drop') {
    const target = document.querySelector('.od-canvas');
    const r = document.querySelector('.od-canvas-slide').getBoundingClientRect();
    const opts = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    target.dispatchEvent(new DragEvent('dragover', opts));
    target.dispatchEvent(new DragEvent('drop', opts));
  } else {
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }
}"""


def _png_b64(color):
    import base64
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (64, 32), color).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_drop_and_paste_images_save_into_deck_media(running):
    from playwright.sync_api import sync_playwright

    server, deck = running
    before = set((deck / "media").iterdir())
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{server.url}/#/deck/{deck.name}")
        ready(page, deck.name)
        page.locator(".od-canvas-slide .slides > section").wait_for()
        page.evaluate(DROP_JS, [_png_b64((255, 0, 0)), "drop"])
        page.wait_for_function("document.querySelectorAll('.od-canvas-slide .sl-block[data-block-type=image]').length === 2", timeout=5000)
        page.evaluate(DROP_JS, [_png_b64((0, 0, 255)), "paste"])
        page.wait_for_function("document.querySelectorAll('.od-canvas-slide .sl-block[data-block-type=image]').length === 3", timeout=5000)
        until(lambda: slides_of(deck).count('data-block-type="image"') == 4)
        assert errors == []
        browser.close()
    new = set((deck / "media").iterdir()) - before
    assert len(new) == 2 and all(f.suffix == ".png" for f in new)
    _, slides = template.read((deck / "index.html").read_text(encoding="utf-8"))
    for f in new:
        assert f'src="media/{f.name}"' in slides


VIDEO_DROP_JS = """async () => {
  const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], 'hdr_A.webm', { type: 'video/webm' }));
  const opts = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 300, clientY: 300 };
  const target = document.querySelector('.od-canvas');
  target.dispatchEvent(new DragEvent('dragover', opts));
  target.dispatchEvent(new DragEvent('drop', opts));
}"""


def test_drop_video_then_set_poster_and_loop(running, tmp_path):
    import base64

    from playwright.sync_api import sync_playwright

    server, deck = running
    poster = tmp_path / "hdr_A.first.png"
    poster.write_bytes(base64.b64decode(_png_b64((0, 200, 0))))
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{server.url}/#/deck/{deck.name}")
        ready(page, deck.name)
        page.locator(".od-canvas-slide .slides > section").wait_for()
        page.evaluate(VIDEO_DROP_JS)
        video = page.locator(".od-canvas-slide .sl-block[data-block-type=video] video")
        video.wait_for(state="attached", timeout=5000)
        assert video.evaluate("v => v.paused && v.preload === 'metadata'")  # the editor never plays clips
        until(lambda: 'data-block-type="video"' in slides_of(deck))
        # unknown size (the bytes are not a real clip): the block fills the slide
        assert "width: 1024px; height: 576px; left: 0px; top: 0px;" in slides_of(deck)
        page.locator(".od-inspector[aria-label=Video]").wait_for()
        with page.expect_file_chooser() as chooser:
            page.get_by_label("Poster: choose an image").click()
        chooser.value.set_files(str(poster))
        until(lambda: 'poster="media/' in slides_of(deck))
        page.locator(".od-inspector .od-check", has_text="Loop").click()
        until(lambda: re.search(r"<video[^>]*\sloop", slides_of(deck)) is not None)
        page.keyboard.press("Control+o")
        assert page.locator(".od-layer", has_text="video").count() == 1
        assert errors == []
        browser.close()
    m = re.search(r'<video src="(media/[0-9a-f]+\.webm)" poster="(media/[0-9a-f]+\.png)"', slides_of(deck))
    assert m and (deck / m.group(1)).is_file() and (deck / m.group(2)).read_bytes() == poster.read_bytes()


def test_text_editing_in_place(running):
    from playwright.sync_api import sync_playwright

    server, deck = running
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{server.url}/#/deck/{deck.name}")
        ready(page, deck.name)
        block = page.locator('.od-canvas-slide .sl-block[data-block-id="t1"] .sl-block-content')
        block.wait_for()
        # untouched: double-click then Escape changes nothing on disk
        before = (deck / "index.html").read_text(encoding="utf-8")
        block.dblclick()
        page.keyboard.press("Escape")
        page.wait_for_timeout(1600)
        assert (deck / "index.html").read_text(encoding="utf-8") == before

        # edit: select all, type, make it bold
        block.dblclick()
        page.keyboard.press("Control+a")
        page.keyboard.type("Vitesses particulières σ8")
        page.keyboard.press("Control+a")
        page.locator(".od-texttools button[title^='Bold']").click()
        page.keyboard.press("Escape")
        until(lambda: "<strong>Vitesses particulières σ8</strong>" in slides_of(deck))
        assert "Croissance" not in slides_of(deck)

        # insert a new text block from the rail: it opens for editing with its text selected
        page.locator(".od-block-btn[aria-label='Add text']").click()
        page.wait_for_timeout(500)
        page.keyboard.type("Nouveau")
        page.keyboard.press("Escape")
        until(lambda: "<p>Nouveau</p>" in slides_of(deck))
        assert errors == []
        browser.close()


def test_math_editing_live(running):
    from playwright.sync_api import sync_playwright

    server, deck = running
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{server.url}/#/deck/{deck.name}")
        ready(page, deck.name)
        math = page.locator('.od-canvas-slide .sl-block[data-block-id="m1"]')
        math.wait_for()
        math.dblclick()
        tex = page.locator(".od-tex")
        tex.wait_for()
        assert page.evaluate("document.activeElement.classList.contains('od-tex')")
        tex.fill(r"f\sigma_8(z) = \frac{d\ln D}{d\ln a}\,\sigma_8")
        page.wait_for_function("document.querySelector('.od-canvas-slide [data-block-id=m1] .katex .mfrac') !== null", timeout=5000)
        page.locator(".od-check input").check()  # display mode
        until(lambda: 'data-math-display="true"' in slides_of(deck) and r"\frac{d\ln D}" in slides_of(deck))
        slides = slides_of(deck)
        assert r'<div class="math-input">f\sigma_8(z) = \frac{d\ln D}{d\ln a}\,\sigma_8</div>' in slides
        assert 'data-math-display="true"' in slides
        assert "math-output" not in slides  # the typeset output is never saved
        assert errors == []
        browser.close()


COPY_JS = """() => { const dt = new DataTransfer();
  document.body.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
  return dt.getData('text/html'); }"""
PASTE_JS = """(html) => { const dt = new DataTransfer(); dt.setData('text/html', html);
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }"""


def test_copy_blocks_and_slides_between_decks(running, make_export):
    from playwright.sync_api import sync_playwright

    server, deck_a = running
    deck_b = deck_a.parent / import_export(make_export(deck_id=77, slug="other-deck"), deck_a.parent).folder
    image = sorted((deck_b / "media").iterdir())[0]
    image.unlink()  # deck B must receive the image from deck A
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{server.url}/#/deck/{deck_a.name}")
        ready(page, deck_a.name)
        page.locator('.od-canvas-slide .sl-block[data-block-id="i1"]').click()
        blocks_clip = page.evaluate(COPY_JS)
        page.keyboard.press("Escape")
        slide_clip = page.evaluate(COPY_JS)  # nothing selected: the whole slide
        assert "data-opendeck-clip" in blocks_clip and "data-opendeck-clip" in slide_clip

        page.goto(f"{server.url}/#/deck/{deck_b.name}")
        page.locator(f'.od-deck-title[title^="{deck_b.name}:"]').wait_for()
        page.locator(".od-canvas-slide .slides > section").wait_for()
        ready(page, deck_b.name)
        page.evaluate(PASTE_JS, blocks_clip)
        page.wait_for_function("document.querySelectorAll('.od-canvas-slide .sl-block[data-block-type=image]').length === 2", timeout=5000)
        page.evaluate(PASTE_JS, slide_clip)
        page.wait_for_function("document.querySelectorAll('.od-slide-thumb').length === 3", timeout=5000)
        until(lambda: slides_of(deck_b).count("<section") == 3)
        assert errors == []
        browser.close()
    assert image.is_file()  # copied back from deck A
    _, slides = template.read((deck_b / "index.html").read_text(encoding="utf-8"))
    assert slides.count("<section") == 3
    assert 'data-block-id="i1"' in slides  # the original slide 1 of B still has its own i1
    assert slides.count(f'src="media/{image.name}"') == 4  # B's 2 + pasted block + pasted slide's 1


def test_draw_arrow_and_edit_endpoint(running):
    from playwright.sync_api import sync_playwright

    server, deck = running
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{server.url}/#/deck/{deck.name}")
        ready(page, deck.name)
        s = page.locator(".od-canvas-slide .slides > section").bounding_box()
        k = s["width"] / 1024
        page.keyboard.press("a")  # arrow tool
        page.mouse.move(s["x"] + 100 * k, s["y"] + 500 * k)
        page.mouse.down()
        page.mouse.move(s["x"] + 300 * k, s["y"] + 500 * k, steps=6)
        page.mouse.up()
        until(lambda: 'data-line-end-type="line-arrow"' in slides_of(deck))
        line = re.search(r'data-block-type="line"[^>]*style="([^"]*)"', slides_of(deck)).group(1)
        assert "left: 100" in line.replace(".0", "") or "left: 99" in line or "left: 100" in line

        # drag the end point up to (300, 400)
        handles = page.locator(".od-endpoint")
        assert handles.count() == 2
        h = handles.nth(1).bounding_box()
        page.mouse.move(h["x"] + 6, h["y"] + 6)
        page.mouse.down()
        page.mouse.move(s["x"] + 300 * k, s["y"] + 400 * k, steps=6)
        page.mouse.up()
        until(lambda: re.search(r'data-line-y1="(\d+(?:\.\d+)?)"', slides_of(deck)) and
              abs(float(re.search(r'data-line-y1="([\d.]+)"', slides_of(deck)).group(1)) - 100) < 2)

        page.locator(".od-inspector select").nth(1).select_option("none")  # End: none
        until(lambda: 'data-line-end-type="none"' in slides_of(deck) and 'class="line-end"' not in slides_of(deck))
        assert errors == []
        browser.close()


def test_font_and_colour(running):
    from playwright.sync_api import sync_playwright

    server, deck = running
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{server.url}/#/deck/{deck.name}")
        ready(page, deck.name)
        content = page.locator('.od-canvas-slide .sl-block[data-block-id="t1"] .sl-block-content')
        # part of the text: select all inside the block, then font + colour from the toolbar
        content.dblclick()
        page.keyboard.press("Control+a")
        page.locator(".od-texttools select[aria-label=Font]").select_option(label="Merriweather")
        page.locator(".od-texttools .od-swatch-btn").click()
        page.locator(".od-palette .od-swatches button[title='#cc0000']").click()
        page.keyboard.press("Escape")
        until(lambda: "Merriweather" in slides_of(deck) and "204, 0, 0" in slides_of(deck) or "#cc0000" in slides_of(deck))
        # the whole block, from the inspector
        page.locator('.od-canvas-slide .sl-block[data-block-id="t1"]').click()
        page.locator(".od-inspector select").first.select_option(label="Lato")
        until(lambda: re.search(r'data-block-id="t1".*?<div class="sl-block-content"[^>]*font-family: Lato', slides_of(deck), re.S))
        assert errors == []
        browser.close()


def test_history_restore(running):
    from playwright.sync_api import sync_playwright

    server, deck = running
    from opendeck.deck import versioning
    versioning.commit(server.historian.mirror, deck, f"{deck.name}: import from slides.com")
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: d.accept())
        page.goto(f"{server.url}/#/deck/{deck.name}")
        ready(page, deck.name)
        content = page.locator('.od-canvas-slide .sl-block[data-block-id="t1"] .sl-block-content')
        content.dblclick()
        page.keyboard.press("Control+a")
        page.keyboard.type("Changed")
        page.keyboard.press("Escape")
        until(lambda: "<p>Changed</p>" in slides_of(deck))
        page.locator(".od-tabs [aria-label=History]").click()
        page.wait_for_function("document.querySelectorAll('.od-version').length >= 2", timeout=10000)
        page.locator(".od-version button", has_text="Restore").last.click()
        until(lambda: "Croissance" in slides_of(deck))
        ready(page, deck.name)
        page.wait_for_function("document.querySelector('.od-canvas-slide [data-block-id=t1]').textContent.includes('Croissance')", timeout=10000)
        assert errors == []
        browser.close()


def test_pen_and_shapes(running):
    from playwright.sync_api import sync_playwright

    server, deck = running
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{server.url}/#/deck/{deck.name}")
        ready(page, deck.name)
        s = page.locator(".od-canvas-slide .slides > section").bounding_box()
        k = s["width"] / 1024
        page.keyboard.press("p")
        page.mouse.move(s["x"] + 700 * k, s["y"] + 450 * k)
        page.mouse.down()
        for i in range(1, 15):
            page.mouse.move(s["x"] + (700 + 10 * i) * k, s["y"] + (450 + (i % 3) * 8) * k)
        page.mouse.up()
        until(lambda: 'data-block-type="drawing"' in slides_of(deck) and "data-points=" in slides_of(deck))
        page.keyboard.press("Escape")

        page.locator(".od-block-btn[aria-label='Add shape']").click()
        page.locator(".od-inspector select").first.select_option("circle")
        until(lambda: 'data-shape-type="circle"' in slides_of(deck) and "<ellipse" in slides_of(deck))
        page.locator(".od-inspector .od-swatch-btn[aria-label=Border]").click()
        page.locator(".od-palette .od-swatches button[title='#000000']").first.click()
        until(lambda: 'data-shape-stroke-color="#000000"' in slides_of(deck) and "clip-path=" in slides_of(deck))
        assert errors == []
        browser.close()


def test_library_places_image_from_another_deck(running, make_export, monkeypatch, tmp_path):
    from playwright.sync_api import sync_playwright

    monkeypatch.setenv("HOME", str(tmp_path / "home"))  # thumbnail cache
    server, deck_a = running
    deck_b = deck_a.parent / import_export(make_export(deck_id=88, slug="b-deck"), deck_a.parent).folder
    from PIL import Image
    Image.new("RGB", (300, 150), (200, 30, 30)).save(deck_a / "media" / "only-in-a.png")
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{server.url}/#/deck/{deck_b.name}")
        ready(page, deck_b.name)
        page.locator(".od-rail-btn[aria-label='Image library']").click()
        item = page.locator(".od-library-item:has(img[src*='only-in-a.png'])")
        item.wait_for()
        item.click()
        until(lambda: (deck_b / "media" / "only-in-a.png").is_file() and 'src="media/only-in-a.png"' in slides_of(deck_b))
        assert errors == []
        browser.close()


def test_duplicate_deck_from_the_deck_list(running):
    from playwright.sync_api import sync_playwright

    server, deck = running
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.goto(f"{server.url}/")
        card = page.locator(".od-card-wrap").first
        card.hover()
        card.locator(".od-card-actions button[aria-label^=Duplicate]").click()
        title = page.locator(".od-modal input")
        assert title.input_value().endswith("(copy)")
        title.fill("Copie du séminaire")
        page.locator(".od-modal button[type=submit]").click()
        page.wait_for_function("location.hash.includes('copie-du-seminaire')", timeout=10000)
        copy = next(d for d in deck.parent.iterdir() if d.name.endswith("_copie-du-seminaire"))
        ready(page, copy.name)
        assert slides_of(copy) == slides_of(deck)
        assert {f.name for f in (copy / "media").iterdir()} == {f.name for f in (deck / "media").iterdir()}
        browser.close()


def test_drag_snaps_to_alignment_guides(running):
    from playwright.sync_api import sync_playwright

    server, deck = running
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{server.url}/#/deck/{deck.name}")
        ready(page, deck.name)
        s = page.locator(".od-canvas-slide .slides > section").bounding_box()
        k = s["width"] / 1024
        image = page.locator('.od-canvas-slide .sl-block[data-block-id="i1"]')
        b = image.bounding_box()

        def drag(dx, alt=False):
            """Drag the image by dx slide px; returns how many guides showed before the drop."""
            x, y = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
            page.mouse.move(x, y)
            page.mouse.down()
            if alt:
                page.keyboard.down("Alt")
            page.mouse.move(x + dx * k, y + 1, steps=10)
            guides = page.locator(".od-guide-x").count()
            page.mouse.up()
            if alt:
                page.keyboard.up("Alt")
            assert page.locator(".od-guide").count() == 0  # hidden on drop
            return guides

        # i1 spans x 500..700; text block t1 spans x 40..640: its right edge (3 px off) catches i1's
        assert drag(-57) >= 1
        until(lambda: "left: 440px" in block_style(deck, "i1"))
        page.keyboard.press("Control+z")
        until(lambda: "left: 500px" in block_style(deck, "i1"))
        # Alt: no snapping
        assert drag(-57, alt=True) == 0
        until(lambda: "left: 500px" not in block_style(deck, "i1") and "left: 440px" not in block_style(deck, "i1"))
        page.keyboard.press("Control+z")
        until(lambda: "left: 500px" in block_style(deck, "i1"))
        # the header toggle turns snapping off, and the choice is remembered
        toggle = page.locator(".od-center-head [aria-label='Snap to alignment guides']")
        assert toggle.get_attribute("aria-pressed") == "true"
        toggle.click()
        assert page.evaluate("localStorage.getItem('opendeck-snap')") == "off"
        assert drag(-57) == 0
        until(lambda: "left: 500px" not in block_style(deck, "i1") and "left: 440px" not in block_style(deck, "i1"))
        page.reload()
        ready(page, deck.name)
        assert page.locator(".od-center-head [aria-label='Snap to alignment guides']").get_attribute("aria-pressed") == "false"
        assert errors == []
        browser.close()


def test_rename_deck_from_editor_and_list(running):
    from playwright.sync_api import sync_playwright

    from opendeck.deck import versioning

    server, deck = running
    versioning.commit(server.historian.mirror, deck, f"{deck.name}: import from slides.com")
    month = deck.name[:7]
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{server.url}/#/deck/{deck.name}")
        ready(page, deck.name)
        # in the editor: click the title, type, Enter; the editor follows the deck to its new folder
        page.locator(".od-deck-title").click()
        page.locator(".od-deck-title-input").fill("Exposé Lyα")
        page.keyboard.press("Enter")
        new = f"{month}_expose-ly"
        page.wait_for_function(f"location.hash === '#/deck/{new}'", timeout=10000)
        ready(page, new)
        assert page.locator(".od-deck-title").text_content() == "Exposé Lyα"
        assert not deck.exists() and (deck.parent / new / "index.html").is_file()
        page.locator(".od-tabs [aria-label=History]").click()
        page.wait_for_function("document.querySelectorAll('.od-version').length >= 2", timeout=10000)

        # from the deck list: the Rename button on a card
        page.goto(f"{server.url}/#/")
        card = page.locator(".od-card-wrap").first
        card.hover()
        card.locator(".od-card-actions button[aria-label^=Rename]").click()
        title = page.locator(".od-modal input")
        assert title.input_value() == "Exposé Lyα"
        title.fill("Final talk")
        page.locator(".od-modal button[type=submit]").click()
        page.wait_for_function("[...document.querySelectorAll('.od-card-title')].some((e) => e.textContent === 'Final talk')", timeout=10000)
        assert (deck.parent / f"{month}_final-talk" / "index.html").is_file() and not (deck.parent / new).exists()
        assert errors == []
        browser.close()
