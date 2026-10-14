"""Run the server in a background thread on 127.0.0.1 (port 0 = any free port)."""

from __future__ import annotations

import asyncio
import socket
import threading
import time

import uvicorn

from ..config import Config
from .app import create_app
from .host import Host


class ServerThread:
    def __init__(self, config: Config, host: Host | None = None, port: int = 0):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", port))
        self.port = self.sock.getsockname()[1]
        allowed = {f"127.0.0.1:{self.port}", f"localhost:{self.port}"}
        app = create_app(config, host, allowed_hosts=allowed)
        self.historian = app.state.historian
        self.server = uvicorn.Server(uvicorn.Config(app, log_level="warning", lifespan="off"))
        self.thread = threading.Thread(target=self._run, name="opendeck-server", daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def _run(self) -> None:
        asyncio.run(self.server.serve(sockets=[self.sock]))

    def start(self, timeout_s: float = 10.0) -> "ServerThread":
        self.thread.start()
        deadline = time.monotonic() + timeout_s
        while not self.server.started:
            if time.monotonic() > deadline or not self.thread.is_alive():
                raise RuntimeError("the opendeck server did not start")
            time.sleep(0.02)
        return self

    def stop(self) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=5)
        self.historian.flush(time.time())  # commit edits still pending to the history mirror
