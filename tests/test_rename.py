"""Renaming a deck: its title, its folder and its history in the mirror."""

import re
from datetime import datetime

import pytest

from opendeck.deck import store, template, versioning


def title_of(deck):
    return template.read((deck / "index.html").read_text(encoding="utf-8"))[0].title


@pytest.fixture
def deck(decks_root):
    d = store.create(decks_root, "Old talk", today=datetime(2024, 3, 5))
    (d / "media" / "x.png").write_bytes(b"png")
    return d


def test_title_and_folder(decks_root, deck):
    slides = template.read((deck / "index.html").read_text(encoding="utf-8"))[1]
    new = store.rename(decks_root, deck, "  Séminaire: P1D  ")
    assert new == decks_root / "2024-03_seminaire-p1d"  # keeps the YYYY-MM prefix
    assert not deck.exists() and title_of(new) == "Séminaire: P1D"
    assert template.read((new / "index.html").read_text(encoding="utf-8"))[1] == slides
    assert (new / "media" / "x.png").read_bytes() == b"png"


def test_same_slug_keeps_folder(decks_root, deck):
    assert store.rename(decks_root, deck, "OLD   talk!") == deck
    assert title_of(deck) == "OLD   talk!"
    other = store.create(decks_root, "Old talk", today=datetime(2024, 3, 5))  # 2024-03_old-talk-2
    assert store.rename(decks_root, other, "old talk") == other


def test_collision_adds_suffix(decks_root, deck):
    store.create(decks_root, "Taken", today=datetime(2024, 3, 1))
    new = store.rename(decks_root, deck, "Taken")
    assert new.name == "2024-03_taken-2" and title_of(new) == "Taken"


def test_empty_slug_refused(decks_root, deck):
    for bad in ("", "   ", "!!!", "Δ"):
        with pytest.raises(ValueError):
            store.rename(decks_root, deck, bad)
    assert deck.is_dir() and title_of(deck) == "Old talk"


def test_mirror_history_follows(decks_root, deck, tmp_path):
    mirror = tmp_path / "mirror"
    assert versioning.commit(mirror, deck, f"{deck.name}: new deck")
    page = deck / "index.html"
    page.write_text(page.read_text(encoding="utf-8").replace("<h2>Old talk", "<h2>Edited"), encoding="utf-8")
    assert versioning.commit(mirror, deck, f"{deck.name}: edit")
    first = versioning.log(mirror, deck.name)[-1][0]

    new = store.rename(decks_root, deck, "New talk", mirror)
    assert new.name == "2024-03_new-talk"
    assert not (mirror / deck.name).exists() and (mirror / new.name / "index.html").is_file()
    assert '"title": "New talk"' in (mirror / new.name / "index.html").read_text(encoding="utf-8")
    subjects = [s for _, _, s in versioning.log(mirror, new.name)]
    assert subjects == [f"{deck.name} -> {new.name}: rename", f"{deck.name}: edit", f"{deck.name}: new deck"]
    assert "<h2>Old talk" in versioning.show(mirror, new.name, first)  # an old version, under the old path
    follow = versioning._git(mirror, "log", "--follow", "--format=%s", "--", f"{new.name}/index.html").stdout
    assert len(follow.splitlines()) == 3

    # a later edit and a restore of a pre-rename version work on the new folder
    versioning.restore(mirror, new, first)
    assert "<h2>Old talk" in (new / "index.html").read_text(encoding="utf-8")


def test_mirror_name_taken_is_skipped(decks_root, deck, tmp_path):
    mirror = tmp_path / "mirror"
    versioning.commit(mirror, deck, "first")
    (mirror / "2024-03_gone").mkdir()  # e.g. the history of a deck since moved to the trash
    assert store.rename(decks_root, deck, "Gone", mirror).name == "2024-03_gone-2"


def test_no_history_no_commit(decks_root, deck, tmp_path):
    mirror = tmp_path / "mirror"
    versioning.ensure_repo(mirror)
    new = store.rename(decks_root, deck, "Elsewhere", mirror)
    assert new.is_dir() and not (mirror / new.name).exists() and not (mirror / deck.name).exists()
    assert versioning.log(mirror, new.name) == []


def test_title_only_rename_is_recorded(decks_root, deck, tmp_path):
    mirror = tmp_path / "mirror"
    versioning.commit(mirror, deck, "first")
    assert store.rename(decks_root, deck, "Old Talk", mirror) == deck
    assert versioning.log(mirror, deck.name)[0][2] == f"{deck.name}: rename"


def test_failure_leaves_deck_unchanged(decks_root, deck, tmp_path, monkeypatch):
    mirror = tmp_path / "mirror"
    versioning.commit(mirror, deck, "first")
    head = versioning._git(mirror, "rev-parse", "HEAD").stdout

    def broken(*args, **kwargs):
        raise RuntimeError("git failed")

    monkeypatch.setattr(versioning, "commit", broken)
    with pytest.raises(RuntimeError):
        store.rename(decks_root, deck, "New name", mirror)
    assert deck.is_dir() and title_of(deck) == "Old talk"
    assert not (decks_root / "2024-03_new-name").exists()
    assert (mirror / deck.name / "index.html").is_file() and not (mirror / "2024-03_new-name").exists()
    assert versioning._git(mirror, "rev-parse", "HEAD").stdout == head
    assert versioning._git(mirror, "status", "--porcelain").stdout == ""


def test_historian_rekeys(tmp_path, decks_root, deck):
    h = store.Historian(tmp_path / "mirror", interval_s=600)
    h.saved(deck, now=0)
    h.saved(deck, now=1)  # pending
    new = store.rename(decks_root, deck, "Moved", h.mirror)
    h.renamed(deck.name, new)
    assert h.pending == {new.name: new} and new.name in h.last and deck.name not in h.last
    h.flush(now=2)
    assert re.fullmatch(r".*: (rename|edit)", versioning.log(h.mirror, new.name)[0][2])
