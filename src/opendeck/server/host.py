"""Things only the desktop can do: a native folder dialog, opening a folder in the file manager.

The server calls a Host. Under the PySide6 window, the window installs a host that runs the
dialog on the Qt GUI thread. Otherwise (opendeck serve, opened in Chrome) the dialog runs in a
short-lived Qt process: python -m opendeck.shell.pickfolder.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


class Host:
    def pick_folder(self, start: Path) -> Path | None:
        out = subprocess.run([sys.executable, "-m", "opendeck.shell.pickfolder", str(start)],
                             capture_output=True, text=True)
        chosen = out.stdout.strip()
        return Path(chosen) if out.returncode == 0 and chosen else None

    def reveal(self, path: Path) -> None:
        subprocess.Popen(["xdg-open", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
