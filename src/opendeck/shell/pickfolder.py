"""Native folder dialog as a tiny process: prints the chosen folder, exit 1 if cancelled.

Usage: python -m opendeck.shell.pickfolder START_DIR
"""

from __future__ import annotations

import sys


def main() -> int:
    from PySide6.QtWidgets import QApplication, QFileDialog

    start = sys.argv[1] if len(sys.argv) > 1 else ""
    app = QApplication.instance() or QApplication(sys.argv[:1])
    chosen = QFileDialog.getExistingDirectory(None, "Export to folder", start)
    del app
    if not chosen:
        return 1
    print(chosen)
    return 0


if __name__ == "__main__":
    sys.exit(main())
