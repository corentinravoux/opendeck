from opendeck.deck import versioning


def test_commit_only_on_change(tmp_path):
    mirror, deck = tmp_path / "mirror", tmp_path / "decks" / "2024-12_demo"
    deck.mkdir(parents=True)
    (deck / "index.html").write_text("v1", encoding="utf-8")
    (deck / "media").mkdir()
    (deck / "media" / "x.png").write_bytes(b"png")
    assert versioning.commit(mirror, deck, "first")
    assert not versioning.commit(mirror, deck, "same again")
    (deck / "index.html").write_text("v2", encoding="utf-8")
    assert versioning.commit(mirror, deck, "second")
    subjects = [s for _, _, s in versioning.log(mirror, deck.name)]
    assert subjects == ["second", "first"]
    assert not (mirror / deck.name / "media").exists()


def test_log_without_repo(tmp_path):
    assert versioning.log(tmp_path / "none", "x") == []
