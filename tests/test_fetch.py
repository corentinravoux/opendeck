import json
import zipfile

import pytest

from opendeck.migrate.fetch import (
    DeckEntry,
    Manifest,
    RequestGuard,
    check_download,
    parse_created,
)


def test_folder_name_uses_creation_month():
    deck = DeckEntry(slug="ede-2026-galaxy-observations-3", title="EDE 2026 - GC 3/4",
                     deck_id="1", created_at="2026-08-21 09:12:00 UTC")
    assert deck.folder_name == "2026-08_ede-2026-galaxy-observations-3"


def test_parse_created_is_utc():
    assert parse_created("2024-12-06 09:09:11 UTC").tzinfo is not None


def test_guard_passes_reads_and_aborts_unknown_writes(tmp_path):
    guard = RequestGuard(tmp_path / "log", allow=[r"/api/v1/decks/\d+/exports"], dry_run=False)
    assert guard.decide("GET", "https://slides.com/someone/x/edit") == "pass"
    assert guard.decide("POST", "https://slides.com/api/v1/decks/12/exports") == "log"
    assert guard.decide("PUT", "https://slides.com/api/v1/decks/12") == "abort"
    assert guard.decide("POST", "https://api.slides.com/v1/decks/12/save") == "abort"
    assert guard.decide("POST", "https://www.google-analytics.com/g/collect") == "log"


def test_guard_dry_run_never_aborts(tmp_path):
    guard = RequestGuard(tmp_path / "log", allow=[], dry_run=True)
    assert guard.decide("PUT", "https://slides.com/api/v1/decks/12") == "log"


def test_manifest_resumes(tmp_path):
    (tmp_path / "a.zip").write_bytes(b"x")
    m = Manifest(tmp_path / "manifest.json")
    assert not m.done("a", "zip")
    m.mark("a", "zip", tmp_path / "a.zip")
    again = Manifest(tmp_path / "manifest.json")
    assert again.done("a", "zip") and not again.done("a", "pdf")
    assert json.loads((tmp_path / "manifest.json").read_text())["a"]["zip"]["bytes"] == 1


def test_manifest_forgets_deleted_files(tmp_path):
    (tmp_path / "a.pdf").write_bytes(b"%PDF-")
    m = Manifest(tmp_path / "manifest.json")
    m.mark("a", "pdf", tmp_path / "a.pdf")
    (tmp_path / "a.pdf").unlink()
    assert not m.done("a", "pdf")


def test_check_download(tmp_path):
    good = tmp_path / "d.zip"
    with zipfile.ZipFile(good, "w") as z:
        z.writestr("slides_d/index.html", "<html></html>")
    check_download(good, "zip")
    bad = tmp_path / "d.pdf"
    bad.write_bytes(b"<html>login</html>")
    with pytest.raises(ValueError):
        check_download(bad, "pdf")
