"""The opendeck window: a Qt WebEngine view on the local server, which runs in a thread.

- Navigation is confined to the local server; other links open in the system browser, and a
  file dropped outside a drop zone cannot navigate the window away.
- The native folder dialog asked for by the page (via the server) runs on the GUI thread.
- OPENDECK_DEVTOOLS=1 opens Chromium's remote debugging on port 9333.
"""

from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

from ..config import Config
from ..server.host import Host
from ..server.thread import ServerThread

ICON = Path(__file__).with_name("opendeck.svg")


def run(config: Config, deck: str | None = None) -> int:
    if os.environ.get("OPENDECK_DEVTOOLS"):
        os.environ.setdefault("QTWEBENGINE_REMOTE_DEBUGGING", "9333")

    from PySide6.QtCore import QObject, QTimer, QUrl, Signal, Slot
    from PySide6.QtGui import QDesktopServices, QGuiApplication, QIcon
    from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineSettings
    from PySide6.QtWebEngineWidgets import QWebEngineView
    from PySide6.QtWidgets import QApplication, QFileDialog, QMainWindow

    class QtHost(QObject, Host):
        """Host whose folder dialog runs on the GUI thread; called from the server thread."""

        ask = Signal(str, object)

        def __init__(self, window: QMainWindow):
            QObject.__init__(self)
            self.window = window
            self.ask.connect(self._ask)

        @Slot(str, object)
        def _ask(self, start: str, reply: dict) -> None:
            reply["path"] = QFileDialog.getExistingDirectory(self.window, "Export to folder", start)
            reply["done"].set()

        def pick_folder(self, start: Path) -> Path | None:
            done = threading.Event()
            reply: dict = {"done": done, "path": ""}
            self.ask.emit(str(start), reply)
            done.wait()
            chosen = str(reply["path"])
            return Path(chosen) if chosen else None

        def reveal(self, path: Path) -> None:
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(path)))

    class Page(QWebEnginePage):
        def __init__(self, profile, origin: str, parent=None):
            super().__init__(profile, parent)
            self.origin = origin

        def acceptNavigationRequest(self, url, nav_type, is_main_frame):
            if url.toString().startswith(self.origin) or url.scheme() in ("about", "data", "blob"):
                return True
            if url.scheme() in ("http", "https", "mailto"):
                QDesktopServices.openUrl(url)
            return False  # file:// drops and anything else stay out

        def createWindow(self, _type):
            # target=_blank (e.g. "Preview in a browser tab") opens in the system browser
            page = QWebEnginePage(self.profile(), self)
            page.urlChanged.connect(lambda u: (QDesktopServices.openUrl(u), page.deleteLater()))
            return page

    # argv[0] names the X11 window instance (WM_CLASS): "opendeck", as the desktop entry expects
    app = QApplication.instance() or QApplication(["opendeck"])
    app.setApplicationName("opendeck")
    QGuiApplication.setDesktopFileName("opendeck")
    class Window(QMainWindow):
        """Lets the page write its last edits before the window closes."""

        flushed = False

        def closeEvent(self, event):
            if self.flushed:
                event.accept()
                return
            event.ignore()
            tries = {"n": 0}

            def check(done=None):
                if done is True or tries["n"] > 30:  # saved, or give up after ~3 s
                    self.flushed = True
                    self.close()
                    return
                tries["n"] += 1
                QTimer.singleShot(100, lambda: page.runJavaScript("window.__odSaved === true", 0, check))

            page.runJavaScript(
                "window.__odSaved = false; (window.opendeckFlush ? window.opendeckFlush() : Promise.resolve(true))"
                ".then(ok => window.__odSaved = true, () => window.__odSaved = true); true", 0, lambda _: check())

    window = Window()
    window.setWindowTitle("opendeck")
    window.setWindowIcon(QIcon(str(ICON)))
    host = QtHost(window)
    server = ServerThread(config, host).start()

    data = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "opendeck" / "qtwebengine"
    profile = QWebEngineProfile("opendeck", window)
    profile.setPersistentStoragePath(str(data))
    profile.setCachePath(str(data / "cache"))
    settings = profile.settings()
    settings.setAttribute(QWebEngineSettings.WebAttribute.JavascriptCanAccessClipboard, True)
    settings.setAttribute(QWebEngineSettings.WebAttribute.JavascriptCanPaste, True)

    view = QWebEngineView(window)
    page = Page(profile, server.url, view)
    view.setPage(page)
    page.titleChanged.connect(lambda t: window.setWindowTitle(t or "opendeck"))
    start = server.url + "/" + (f"#/deck/{deck}" if deck else "")
    view.load(QUrl(start))
    window.setCentralWidget(view)
    window.resize(1440, 900)
    window.show()
    def release() -> None:
        # the page must go before its profile, or Qt WebEngine complains at exit
        view.setPage(None)
        page.deleteLater()

    app.aboutToQuit.connect(release)
    try:
        return app.exec()
    finally:
        server.stop()
