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
