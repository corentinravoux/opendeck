"""Where decks, exports and the history mirror live.

Every setting has a generic default; ~/.config/opendeck/config.toml overrides any of them:

    decks_root = "~/Documents/Slides/decks"     # one folder per deck
    export_root = "~/Documents/Slides"          # exports may only be written below this folder
    mirror_root = "~/.local/share/opendeck/history"
    slidescom_user = "your-username"            # only for `opendeck migrate fetch`

Optional, off unless set: keep the media in the history mirror too, and publish decks as a website.

    mirror_media = true                         # the mirror keeps each deck's media, not only index.html
    publish_remote = "git@github.com:you/decks.git"   # enables publishing: `opendeck publish` pushes there
    publish_title = "Talks"                     # heading of the published list of talks
    publish_exclude = ["*_playground"]          # deck folders (glob patterns) never published, even public
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
    mirror_media: bool = False
    publish_remote: str = ""
    publish_title: str = "Talks"
    publish_exclude: tuple[str, ...] = ()

    @property
    def publishing(self) -> bool:
        """Publishing is on only when a remote is configured (decks then get a public/private switch)."""
        return bool(self.publish_remote)

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
    def value(k, v):
        if types[k] == "Path":
            return Path(v).expanduser()
        if types[k] == "bool":
            if not isinstance(v, bool):
                raise ValueError(f"{path}: {k} must be true or false")
            return v
        if types[k].startswith("tuple"):
            if not isinstance(v, list):
                raise ValueError(f"{path}: {k} must be a list")
            return tuple(str(x) for x in v)
        return str(v)

    values = {k: value(k, v) for k, v in data.items()}
    return replace(config, **values)
