"""The local HTTP server behind the editor window (and behind Chrome, for debugging).

Bound to 127.0.0.1 only. Two guards protect it from other pages open in a browser:
- the Host header must name this server (stops DNS-rebinding attacks);
- every request that changes something must carry `X-Opendeck: 1`. A cross-origin page cannot
  add that header without a CORS preflight, which this server never approves.
"""

from __future__ import annotations

import time
from pathlib import Path

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from .. import __version__, paths
from ..config import Config
from ..deck import media, store, versioning
from ..export import runtime
from .host import Host

WEB = Path(__file__).resolve().parents[1] / "_web" / "app"
SAFE = {"GET", "HEAD", "OPTIONS"}
MAX_UPLOAD = 200 * 1024 * 1024


class Guard(BaseHTTPMiddleware):
    def __init__(self, app, allowed_hosts: set[str]):
        super().__init__(app)
        self.allowed_hosts = allowed_hosts

    async def dispatch(self, request: Request, call_next):
        host = request.headers.get("host", "")
        if self.allowed_hosts and host not in self.allowed_hosts:
            return PlainTextResponse("unknown host", status_code=403)
        if request.method not in SAFE and request.headers.get("x-opendeck") != "1":
            return PlainTextResponse("missing X-Opendeck header", status_code=403)
        return await call_next(request)


def error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


def create_app(config: Config, host: Host | None = None, allowed_hosts: set[str] | None = None) -> Starlette:
    host = host or Host()
    historian = store.Historian(config.mirror_root)

    def deck_or_error(request: Request) -> tuple[Path, None] | tuple[None, JSONResponse]:
        try:
            return paths.deck_dir(config, request.path_params["name"]), None
        except ValueError as exc:
            return None, error(400, str(exc))
        except FileNotFoundError as exc:
            return None, error(404, str(exc))

    async def health(request: Request):
        return JSONResponse({"version": __version__, "decks_root": str(config.decks_root),
                             "export_root": str(config.export_root)})

    async def decks(request: Request):
        return JSONResponse(store.as_dicts(await run_in_threadpool(store.list_decks, config.decks_root)))

    async def new_deck(request: Request):
        body = await request.json()
        title = str(body.get("title", "")).strip()
        if not title:
            return error(400, "a new deck needs a title")
        d = await run_in_threadpool(store.create, config.decks_root, title)
        await run_in_threadpool(versioning.commit, config.mirror_root, d, f"{d.name}: new deck")
        return JSONResponse({"name": d.name})

    async def deck(request: Request):
        d, err = deck_or_error(request)
        if d is None:
            return err
        return JSONResponse(await run_in_threadpool(store.read, d))

    async def save(request: Request):
        d, err = deck_or_error(request)
        if d is None:
            return err
        body = await request.json()
        try:
            new_etag = await run_in_threadpool(store.save, d, body.get("slides", ""), body.get("etag", ""),
                                               body.get("meta"))
        except store.Conflict:
            return error(409, "the deck changed on disk since it was opened; reload it")
        except ValueError as exc:
            return error(400, str(exc))
        committed = await run_in_threadpool(historian.saved, d, time.time(), bool(body.get("commit")))
        return JSONResponse({"etag": new_etag, "committed": committed})

    async def remove(request: Request):
        d, err = deck_or_error(request)
        if d is None:
            return err
        await run_in_threadpool(historian.flush, time.time())
        where = await run_in_threadpool(store.trash, config.decks_root, d)
        return JSONResponse({"trash": str(where)})

    async def upload(request: Request):
        d, err = deck_or_error(request)
        if d is None:
            return err
        data = await request.body()
        if not data:
            return error(400, "empty upload")
        if len(data) > MAX_UPLOAD:
            return error(413, "file too large")
        from urllib.parse import unquote

        name = unquote(request.headers.get("x-filename", ""))
        if media.sniff(data, name) not in media.IMAGE_TYPES:
            return error(415, "not an image (png, jpg, gif, webp, svg, avif)")
        rel, existed = await run_in_threadpool(media.store, d, data, name)
        width, height = await run_in_threadpool(media.dimensions, d / rel)
        return JSONResponse({"src": rel, "width": width, "height": height, "deduped": existed})

    async def media_copy(request: Request):
        d, err = deck_or_error(request)
        if d is None:
            return err
        body = await request.json()
        try:
            src = paths.deck_dir(config, str(body.get("from", "")))
            copied = await run_in_threadpool(media.copy_between, src, d, [str(x) for x in body.get("srcs", [])])
        except (ValueError, FileNotFoundError) as exc:
            return error(400, str(exc))
        return JSONResponse({"copied": copied})

    async def history(request: Request):
        d, err = deck_or_error(request)
        if d is None:
            return err
        await run_in_threadpool(historian.flush, time.time())  # include edits not yet recorded
        entries = await run_in_threadpool(versioning.log, config.mirror_root, d.name)
        return JSONResponse([{"rev": h, "date": date, "message": msg} for h, date, msg in entries])

    async def history_view(request: Request):
        d, err = deck_or_error(request)
        if d is None:
            return err
        try:
            page = await run_in_threadpool(versioning.show, config.mirror_root, d.name, request.path_params["rev"])
        except (ValueError, FileNotFoundError) as exc:
            return error(404, str(exc))
        await run_in_threadpool(runtime.install, d)
        base = f'<base href="/view/{d.name}/">'
        return HTMLResponse(page.replace("<head>", f"<head>\n{base}", 1))

    async def history_restore(request: Request):
        d, err = deck_or_error(request)
        if d is None:
            return err
        try:
            await run_in_threadpool(versioning.restore, config.mirror_root, d, request.path_params["rev"])
        except (ValueError, FileNotFoundError) as exc:
            return error(400, str(exc))
        return JSONResponse({"ok": True})

    async def media_library(request: Request):
        titles = {d.name: d.title for d in await run_in_threadpool(store.list_decks, config.decks_root)}
        items = await run_in_threadpool(media.library, config.decks_root, titles)
        return JSONResponse(items)

    async def thumb(request: Request):
        d, err = deck_or_error(request)
        if d is None:
            return err
        name = request.path_params["file"]
        src = d / media.MEDIA_DIR / name
        if "/" in name or name.startswith(".") or not src.is_file():
            return error(404, "not found")
        width = min(800, max(32, int(request.query_params.get("w", "240"))))
        cache = Path.home() / ".cache" / "opendeck" / "thumbs"
        try:
            path = await run_in_threadpool(media.thumbnail, src, cache, width)
        except Exception:
            path = src  # unreadable by Pillow: let the browser try the original
        return FileResponse(path, headers={"Cache-Control": "max-age=86400"})

    async def exports(request: Request):
        d, err = deck_or_error(request)
        if d is None:
            return err
        return JSONResponse(store.remembered_exports(d))

    async def export(request: Request):
        d, err = deck_or_error(request)
        if d is None:
            return err
        body = await request.json()
        kind = body.get("kind")
        if kind not in ("pdf", "html"):
            return error(400, "kind must be pdf or html")
        try:
            folder = paths.export_destination(config, body.get("dir", ""))
            name = paths.safe_filename(body.get("name") or d.name)
        except (PermissionError, ValueError) as exc:
            return error(400, str(exc))
        as_zip, overwrite = bool(body.get("zip")), bool(body.get("overwrite"))

        def run() -> Path:
            if kind == "pdf":
                from ..export.pdf import export_pdf

                target = folder / f"{name}.pdf"
                if target.exists() and not overwrite:
                    raise FileExistsError(str(target))
                return export_pdf(d, target)
            from ..export.html import export_html, export_single

            if body.get("single"):
                return export_single(d, folder, name, overwrite=overwrite)
            return export_html(d, folder, name, as_zip=as_zip, overwrite=overwrite)

        try:
            target = await run_in_threadpool(run)
        except FileExistsError as exc:
            return error(409, f"{exc} already exists")
        store.remember_export(d, "single" if body.get("single") else kind, folder, name, as_zip)
        return JSONResponse({"path": str(target)})

    async def dirs(request: Request):
        try:
            base = paths.export_destination(config, request.query_params.get("path") or config.export_root)
        except PermissionError as exc:
            return error(400, str(exc))
        if not base.is_dir():
            return error(404, f"no folder {base}")
        decks_root = config.decks_root.resolve()
        children = sorted(p.name for p in base.iterdir()
                          if p.is_dir() and not p.name.startswith(".") and p.resolve() != decks_root)
        parent = str(base.parent) if base != paths.nfc(config.export_root.resolve()) else None
        return JSONResponse({"path": str(base), "parent": parent, "children": children})

    async def pick_folder(request: Request):
        body = await request.json()
        start = Path(body.get("start") or config.export_root)
        chosen = await run_in_threadpool(host.pick_folder, start)
        if chosen is None:
            return JSONResponse({"path": None})
        try:
            return JSONResponse({"path": str(paths.export_destination(config, chosen))})
        except PermissionError as exc:
            return error(400, str(exc))

    async def reveal(request: Request):
        body = await request.json()
        target = paths.nfc(Path(body.get("path", "")).expanduser().resolve())
        folder = target if target.is_dir() else target.parent
        roots = [paths.nfc(config.export_root.resolve()), paths.nfc(config.decks_root.resolve())]
        if not any(folder == r or folder.is_relative_to(r) for r in roots):
            return error(400, "can only open folders under the export or decks folder")
        await run_in_threadpool(host.reveal, folder)
        return JSONResponse({"ok": True})

    async def view(request: Request):
        d, err = deck_or_error(request)
        if d is None:
            return err
        rel = request.path_params.get("path") or "index.html"
        if rel.startswith(".opendeck") or "/." in f"/{rel}":
            return error(404, "not found")
        if rel == "index.html" or rel.startswith("lib/"):
            await run_in_threadpool(runtime.install, d)
        target = (d / rel).resolve()
        if not target.is_relative_to(d.resolve()) or not target.is_file():
            return error(404, "not found")
        return FileResponse(target)

    async def app_index(request: Request):
        index = WEB / "index.html"
        if not index.is_file():
            return PlainTextResponse("editor not built: run `npm run build` in web/", status_code=503)
        return FileResponse(index, headers={"Cache-Control": "no-store"})

    routes: list[Route | Mount] = [
        Route("/api/health", health),
        Route("/api/decks", decks),
        Route("/api/decks", new_deck, methods=["POST"]),
        Route("/api/decks/{name}", deck),
        Route("/api/decks/{name}", save, methods=["PUT"]),
        Route("/api/decks/{name}", remove, methods=["DELETE"]),
        Route("/api/decks/{name}/media", upload, methods=["POST"]),
        Route("/api/decks/{name}/media/copy", media_copy, methods=["POST"]),
        Route("/api/decks/{name}/exports", exports),
        Route("/api/decks/{name}/history", history),
        Route("/api/decks/{name}/history/{rev}/restore", history_restore, methods=["POST"]),
        Route("/history/{name}/{rev}/", history_view),
        Route("/api/decks/{name}/export", export, methods=["POST"]),
        Route("/api/library", media_library),
        Route("/api/thumb/{name}/{file}", thumb),
        Route("/api/fs/dirs", dirs),
        Route("/api/host/pick-folder", pick_folder, methods=["POST"]),
        Route("/api/host/reveal", reveal, methods=["POST"]),
        Route("/view/{name}/", view),
        Route("/view/{name}/{path:path}", view),
        Route("/", app_index),
        Route("/favicon.ico", lambda request: PlainTextResponse("", status_code=204)),
    ]
    if (WEB / "assets").is_dir():
        routes.append(Mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets"))
    app = Starlette(routes=routes, middleware=[Middleware(Guard, allowed_hosts=allowed_hosts or set())])
    app.state.historian = historian
    return app

