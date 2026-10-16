"""Add opendeck to the desktop's application menu."""

from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

ENTRY = """[Desktop Entry]
Type=Application
Name=opendeck
GenericName=Slide editor
Comment=Edit and export HTML slide decks offline
Exec={exec}
Icon=opendeck
Terminal=false
Categories=Office;Presentation;
Keywords=slides;presentation;reveal;deck;
StartupWMClass=opendeck
"""


ICON = Path(__file__).with_name("opendeck.svg")


PNG_SIZES = (16, 24, 32, 48, 64, 128, 256, 512)


def _install_icons(hicolor: Path) -> None:
    """The icon in the user's hicolor theme: the SVG, plus PNGs for docks and menus that prefer
    bitmaps (rendered with Qt when it is available)."""
    scalable = hicolor / "scalable" / "apps"
    scalable.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ICON, scalable / "opendeck.svg")
    try:
        from PySide6.QtCore import Qt
        from PySide6.QtGui import QGuiApplication, QImage, QPainter
        from PySide6.QtSvg import QSvgRenderer
    except ImportError:
        return
    _app = QGuiApplication.instance() or QGuiApplication(["opendeck", "-platform", "offscreen"])
    renderer = QSvgRenderer(str(ICON))
    for size in PNG_SIZES:
        image = QImage(size, size, QImage.Format.Format_ARGB32)
        image.fill(Qt.GlobalColor.transparent)
        painter = QPainter(image)
        renderer.render(painter)
        painter.end()
        folder = hicolor / f"{size}x{size}" / "apps"
        folder.mkdir(parents=True, exist_ok=True)
        image.save(str(folder / "opendeck.png"))


def install_desktop_entry() -> Path:
    share = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    _install_icons(share / "icons" / "hicolor")
    apps = share / "applications"
    apps.mkdir(parents=True, exist_ok=True)
    path = apps / "opendeck.desktop"
    path.write_text(ENTRY.format(exec=f"{shlex.quote(sys.executable)} -m opendeck"))
    # let the desktop pick up the entry and the icon now (both tools are optional)
    for cmd in (["update-desktop-database", str(apps)], ["gtk-update-icon-cache", "-q", "-t", "-f", str(share / "icons" / "hicolor")]):
        if shutil.which(cmd[0]):
            subprocess.run(cmd, check=False, capture_output=True)
    return path
