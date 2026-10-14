"""Add opendeck to the desktop's application menu."""

from __future__ import annotations

import os
import shlex
import sys
from pathlib import Path

ENTRY = """[Desktop Entry]
Type=Application
Name=opendeck
GenericName=Slide editor
Comment=Edit and export HTML slide decks offline
Exec={exec}
Icon=x-office-presentation
Terminal=false
Categories=Office;Presentation;
Keywords=slides;presentation;reveal;deck;
StartupWMClass=opendeck
"""


def install_desktop_entry() -> Path:
    share = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    apps = share / "applications"
    apps.mkdir(parents=True, exist_ok=True)
    path = apps / "opendeck.desktop"
    path.write_text(ENTRY.format(exec=f"{shlex.quote(sys.executable)} -m opendeck"))
    return path
