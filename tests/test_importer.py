import json
import re
import zipfile

import pytest

from opendeck.deck import template, versioning
from opendeck.importer.slidescom import ExportSource, import_export

from conftest import EXAMPLES, PNG


@pytest.mark.parametrize("as_zip", [True, False])
def test_import_basic(make_export, decks_root, as_zip):
    report = import_export(make_export(as_zip=as_zip), decks_root)
    assert report.folder == "2024-12_demo-deck"
    deck = decks_root / report.folder
    meta, slides = template.read((deck / "index.html").read_text(encoding="utf-8"))
    assert meta.title == "Démo deck" and (meta.width, meta.height) == (1024, 576)
    assert meta.source["slconfig"]["deck"]["id"] == 42
    assert "Croissance « fσ<sub>8</sub> » — éàü" in slides
    assert "\\lambda_{\\mathrm{obs}}" in slides
    srcs = re.findall(r'<img[^>]*\ssrc="([^"]+)"', slides)
    assert len(srcs) == 2 and all(s.startswith("media/") for s in srcs)
    assert "data-src" not in slides and "data-lazy-loaded" not in slides
    assert (deck / srcs[0]).read_bytes() == PNG
    assert report.media_files == 1 and report.missing_refs == [] and report.remote_refs == []
    assert report.blocks == {"image": 2, "text": 1, "math": 1}
    assert report.features["background_color"] == 1


def test_never_reads_lib(make_export, decks_root, monkeypatch):
    export = make_export()
    opened = []
    real_open = zipfile.ZipFile.open

    def spy(self, name, *args, **kwargs):
        opened.append(getattr(name, "filename", name))
        return real_open(self, name, *args, **kwargs)

    monkeypatch.setattr(zipfile.ZipFile, "open", spy)
    import_export(export, decks_root)
    assert opened and not any(n.startswith("lib/") for n in opened)


def test_export_source_refuses_lib(make_export):
    with pytest.raises(PermissionError):
        ExportSource(make_export()).read("lib/offline.js")


def test_reimport_needs_force_and_other_deck_gets_suffix(make_export, decks_root, tmp_path):
    mirror = tmp_path / "mirror"
    import_export(make_export(), decks_root, mirror=mirror)
    with pytest.raises(FileExistsError):
        import_export(make_export(), decks_root)
    import_export(make_export(), decks_root, mirror=mirror, force=True)
    other = import_export(make_export(deck_id=99), decks_root)
    assert other.folder == "2024-12_demo-deck-2"
    assert versioning.log(mirror, "2024-12_demo-deck")[-1][2] == "2024-12_demo-deck: import from slides.com"


def test_listing_folder_and_reference_pdf(make_export, decks_root, tmp_path):
    pdf = tmp_path / "ref.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    report = import_export(make_export(), decks_root, listing={"folder": "2026-08_demo-deck"}, reference_pdf=pdf)
    deck = decks_root / report.folder
    assert report.folder == "2026-08_demo-deck"
    assert (deck / ".opendeck" / "reference" / "slidescom.pdf").read_bytes() == b"%PDF-1.4"
    assert json.loads((deck / ".opendeck" / "import-report.json").read_text())["slides"] == 2


@pytest.mark.examples
@pytest.mark.skipif(not EXAMPLES.is_dir(), reason="real example decks absent")
@pytest.mark.parametrize("name,slides,images", [
    ("slides_desi-x-ztf", 26, 32),
    ("slides_adecophy-2026-lyman-alpha-ravoux", 63, 87),
    ("slides_ede-2026-galaxy-observations-3", 90, 201),
])
def test_real_examples(decks_root, name, slides, images):
    report = import_export(EXAMPLES / name, decks_root)
    assert report.slides == slides and report.blocks["image"] == images
    assert report.missing_refs == [] and report.unknown_blocks == []
    page = (decks_root / report.folder / "index.html").read_text(encoding="utf-8")
    original = (EXAMPLES / name / "index.html").read_text(encoding="utf-8")
    # every text block's inner HTML survives byte for byte
    texts = re.findall(r'data-block-type="text".*?<div class="sl-block-content"[^>]*>(.*?)</div></div>', original)
    assert texts and all(t in page for t in texts)
