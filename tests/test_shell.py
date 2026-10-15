import os
import subprocess
import sys
import textwrap

import pytest

pytest.importorskip("PySide6.QtWebEngineWidgets")
from opendeck.server.app import WEB  # noqa: E402

SCRIPT = textwrap.dedent("""
    import sys
    from pathlib import Path
    from PySide6.QtCore import QTimer
    from PySide6.QtWidgets import QApplication
    from opendeck.config import Config
    from opendeck.shell import window as w
    app = QApplication(sys.argv[:1])
    root = Path(sys.argv[1])
    def probe():
        win = [x for x in app.topLevelWidgets() if x.isVisible()][0]
        win.centralWidget().page().runJavaScript(
            "document.querySelector('.od-home .od-brand-name') ? 'ok' : 'missing'", 0,
            lambda r: (print('PAGE', r), app.quit()))
    QTimer.singleShot(4000, probe)
    sys.exit(w.run(Config(decks_root=root, export_root=root.parent, mirror_root=root / "m")))
""")


@pytest.mark.skipif(not (WEB / "index.html").is_file(), reason="app not built")
def test_window_boots_and_loads_the_app(tmp_path, decks_root):
    env = os.environ | {"QT_QPA_PLATFORM": "offscreen",
                        "QTWEBENGINE_CHROMIUM_FLAGS": "--disable-gpu --disable-gpu-compositing",
                        "XDG_DATA_HOME": str(tmp_path / "share")}
    out = subprocess.run([sys.executable, "-c", SCRIPT, str(decks_root)], env=env,
                         capture_output=True, text=True, timeout=90)
    assert "PAGE ok" in out.stdout, out.stderr[-2000:]
    assert out.returncode == 0
