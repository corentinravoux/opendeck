from pathlib import Path

import pytest

from opendeck.config import Config, load


def test_defaults_without_file(tmp_path):
    config = load(tmp_path / "missing.toml")
    assert config == Config()
    assert config.inbox == config.decks_root / "_inbox"


def test_overrides_and_accents(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text('decks_root = "~/Dossier é x/decks"\nslidescom_user = "someone"\n', encoding="utf-8")
    config = load(path)
    assert config.decks_root == Path.home() / "Dossier é x" / "decks"
    assert config.slidescom_user == "someone"


def test_unknown_key_is_an_error(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text('deck_root = "/x"\n', encoding="utf-8")
    with pytest.raises(ValueError, match="unknown keys"):
        load(path)
