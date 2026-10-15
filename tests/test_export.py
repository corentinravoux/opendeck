import shutil
import subprocess
import zipfile

import pytest

from opendeck.export import runtime
from opendeck.export.html import export_html, referenced_media
from opendeck.importer.slidescom import import_export

needs_build = pytest.mark.skipif(not (runtime.BUILD / "opendeck.js").is_file(), reason="runtime not built")
needs_chrome = pytest.mark.skipif(not shutil.which("google-chrome"), reason="no system Chrome")


@pytest.fixture
def deck(make_export, decks_root):
    report = import_export(make_export(), decks_root)
    d = decks_root / report.folder
    (d / "media" / "unused.png").write_bytes(b"\x89PNG\r\n\x1a\nunused")
    return d


def test_referenced_media():
    page = '<img src="media/ab12.png"><section data-background-image="media/cd34.jpg"> url("media/ef.svg")'
    assert referenced_media(page) == ["media/ab12.png", "media/cd34.jpg", "media/ef.svg"]


@needs_build
def test_runtime_install_is_idempotent(deck):
    assert runtime.install(deck)
    assert not runtime.install(deck)
    assert (deck / "lib" / "opendeck.js").is_file()
    fonts = {p.name for p in (deck / "lib" / "fonts").iterdir()}
    assert any(n.startswith("OpenSans-Regular") for n in fonts)
    assert not any(n.startswith("KaTeX_") and not n.endswith(".woff2") for n in fonts)


@needs_build
@pytest.mark.parametrize("as_zip", [False, True])
def test_export_html_copies_only_used_media(deck, tmp_path, as_zip):
    out = tmp_path / "Exports é" / "Conférences"
    target = export_html(deck, out, "demo talk", as_zip=as_zip)
    if as_zip:
        names = zipfile.ZipFile(target).namelist()
        assert "demo talk/index.html" in names and "demo talk/lib/opendeck.js" in names
        media = [n for n in names if "/media/" in n]
    else:
        assert (target / "index.html").is_file() and (target / "lib" / "opendeck.css").is_file()
        media = [p.name for p in (target / "media").iterdir()]
        assert not (target / ".opendeck").exists()
    assert len(media) == 1 and not any("unused" in n for n in media)
    with pytest.raises(FileExistsError):
        export_html(deck, out, "demo talk", as_zip=as_zip)


@needs_build
@needs_chrome
def test_export_pdf_pages_and_size(deck, tmp_path):
    from opendeck.export.pdf import export_pdf

    out = export_pdf(deck, tmp_path / "Exports é" / "demo.pdf")
    info = subprocess.run(["pdfinfo", str(out)], capture_output=True, text=True, check=True).stdout
    assert "Pages:           2" in info
    assert "768 x 432 pts" in info
    text = subprocess.run(["pdftotext", str(out), "-"], capture_output=True, text=True, check=True).stdout
    assert "Croissance" in text


@needs_build
def test_export_single_file_is_self_contained(deck, tmp_path):
    from opendeck.export.html import export_single

    out = export_single(deck, tmp_path / "Exports é", "talk")
    page = out.read_text(encoding="utf-8")
    assert out.name == "talk.html"
    assert 'src="media/' not in page and "lib/opendeck" not in page
    assert "data:image/png;base64," in page and "data:font/ttf;base64," in page
    assert page.count("<script") == 2  # metadata + inlined runtime


WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 64


def _png(colour) -> bytes:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (64, 36), colour).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def video_deck(decks_root):
    """A deck with two full-slide video blocks: one with a print image, one with a poster only."""
    from opendeck.deck import media, store, template

    d = store.create(decks_root, "Video talk")
    clip = media.store(d, WEBM, "hdr_A.webm")[0]
    first = media.store(d, _png((0, 200, 0)), "hdr_A.first.png")[0]
    last = media.store(d, _png((220, 0, 0)), "hdr_A.last.png")[0]
    poster = media.store(d, _png((0, 0, 220)), "hdr_B.first.png")[0]

    def block(bid, attrs):
        return (f'<div class="sl-block" data-block-type="video" style="width: 1024px; height: 576px; left: 0px; top: 0px;" '
                f'data-block-id="{bid}"><div class="sl-block-content" style="z-index: 10;">'
                f'<video src="{clip}" {attrs} muted playsinline preload="auto"></video></div></div>')

    with_print, poster_only = f'poster="{first}" data-print="{last}"', f'poster="{poster}"'
    slides = (f'<section data-id="s1">{block("v1", with_print)}</section>'
              f'<section data-id="s2">{block("v2", poster_only)}</section>')
    meta, _ = template.read((d / "index.html").read_text(encoding="utf-8"))
    (d / "index.html").write_text(template.render(meta, slides), encoding="utf-8")
    (d / "media" / "orphan.png").write_bytes(_png((9, 9, 9)))
    return d, {"clip": clip, "first": first, "last": last, "poster": poster}


def test_referenced_media_finds_video_files():
    page = ('<video src="media/a.webm" poster="media/a.png" data-print="media/b.png">'
            '<source src="media/a.mp4" type="video/mp4"></video>')
    assert referenced_media(page) == ["media/a.mp4", "media/a.png", "media/a.webm", "media/b.png"]


@needs_build
def test_export_html_brings_video_poster_and_print(video_deck, tmp_path):
    deck, files = video_deck
    target = export_html(deck, tmp_path / "out", "talk")
    got = sorted(f"media/{p.name}" for p in (target / "media").iterdir())
    assert got == sorted(set(files.values()))


@needs_build
def test_export_single_inlines_video(video_deck, tmp_path):
    from opendeck.export.html import export_single

    deck, _ = video_deck
    page = export_single(deck, tmp_path / "out", "talk").read_text(encoding="utf-8")
    assert '<video src="data:video/webm;base64,' in page
    assert 'poster="data:image/png;base64,' in page and 'data-print="data:image/png;base64,' in page
    assert '"media/' not in page


@needs_build
@needs_chrome
def test_export_pdf_prints_video_stills(video_deck, tmp_path):
    from PIL import Image

    from opendeck.export.pdf import export_pdf

    deck, _ = video_deck
    out = export_pdf(deck, tmp_path / "talk.pdf")
    subprocess.run(["pdftoppm", "-r", "24", "-png", str(out), str(tmp_path / "page")], check=True)
    pages = sorted(tmp_path.glob("page-*.png"))
    assert len(pages) == 2
    images = [Image.open(p).convert("RGB") for p in pages]
    red, blue = (im.getpixel((im.width // 2, im.height // 2)) for im in images)
    assert red[0] > 180 and red[1] < 60 and red[2] < 60, red     # slide 1: data-print (last frame), not the poster
    assert blue[2] > 180 and blue[0] < 60 and blue[1] < 60, blue  # slide 2: no data-print, so the poster
