"""Where decks, exports and the history mirror live.

Every setting has a generic default; ~/.config/opendeck/config.toml overrides any of them:

    decks_root = "~/Documents/Slides/decks"     # one folder per deck
    export_root = "~/Documents/Slides"          # exports may only be written below this folder
    mirror_root = "~/.local/share/opendeck/history"
    slidescom_user = "your-username"            # only for `opendeck migrate fetch`
"""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, fields, replace
from pathlib import Path

CONFIG_PATH = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "opendeck" / "config.toml"
DATA_HOME = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))


@dataclass(frozen=True)
class Config:
    decks_root: Path = Path.home() / "Documents" / "Slides" / "decks"
    export_root: Path = Path.home() / "Documents" / "Slides"
    mirror_root: Path = DATA_HOME / "opendeck" / "history"
    slidescom_user: str = ""

    @property
    def inbox(self) -> Path:
        return self.decks_root / "_inbox"

    @property
    def reports(self) -> Path:
        return self.decks_root / "_reports"


def load(path: Path = CONFIG_PATH) -> Config:
    config = Config()
    if not path.is_file():
        return config
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    types = {f.name: f.type for f in fields(Config)}
    unknown = set(data) - set(types)
    if unknown:
        raise ValueError(f"{path}: unknown keys {sorted(unknown)}; known: {sorted(types)}")
    values = {k: (Path(v).expanduser() if types[k] == "Path" else str(v)) for k, v in data.items()}
    return replace(config, **values)
