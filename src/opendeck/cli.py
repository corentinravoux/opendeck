"""Command line entry point."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .config import load


def _migrate_fetch(args) -> int:
    from .migrate import fetch

    config = load()
    inbox = args.out or config.inbox
    user = args.user or config.slidescom_user
    if not user:
        sys.exit("no slides.com username: pass --user or set slidescom_user in the config file")
    failures = fetch.run(
        cdp_url=args.cdp, inbox=inbox, username=user, only=args.only,
        exclude=args.exclude, allow=args.allow, dry_run=args.dry_run,
        pause_s=args.pause, timeout_s=args.timeout,
    )
    print(f"done; {failures} failure(s). Log of non-GET requests: {inbox / 'requests.log'}")
    return 1 if failures else 0


def _import(args) -> int:
    from .importer.slidescom import import_export

    config = load()
    report = import_export(args.export, config.decks_root, folder=args.folder,
                           reference_pdf=args.pdf, mirror=config.mirror_root, force=args.force)
    print(f"{config.decks_root / report.folder}: {report.slides} slides, {report.media_files} media files")
    for label, items in (("missing", report.missing_refs), ("remote", report.remote_refs)):
        if items:
            print(f"  {len(items)} {label} references, e.g. {items[0]}")
    return 0


def _migrate_import(args) -> int:
    from .migrate import batch

    config = load()
    return 1 if batch.run(config.inbox, config.decks_root, config.mirror_root, force=args.force) else 0


def _migrate_census(args) -> int:
    from .migrate import census

    config = load()
    census.run(config.decks_root, config.reports / "census.json")
    return 0


def _measure(args) -> int:
    from .migrate import measure

    measure.run(args.exports, args.out)
    return 0


def _regress(args) -> int:
    from datetime import date

    from .migrate import regress

    config = load()
    decks = ([d if d.is_absolute() or d.exists() else config.decks_root / d for d in args.decks]
             or regress.decks_with_reference(config.decks_root))
    out = args.out or config.reports / f"regress-{date.today():%Y%m%d}"
    results = regress.run(decks, out)
    return 0 if all(r.ok for r in results) else 1


def _export(args) -> int:
    import unicodedata

    config = load()
    deck = args.deck if args.deck.is_dir() else config.decks_root / args.deck
    if not (deck / "index.html").is_file():
        sys.exit(f"no deck at {deck}")
    out = Path(unicodedata.normalize("NFC", str(args.out.expanduser().resolve())))
    root = config.export_root.resolve()
    if not out.is_relative_to(root) or out.is_relative_to(config.decks_root.resolve()):
        sys.exit(f"--out must be inside {root} and outside {config.decks_root}")
    name = args.name or deck.name
    if args.kind == "pdf":
        from .export.pdf import export_pdf

        target = out / f"{name}.pdf"
        if target.exists() and not args.overwrite:
            sys.exit(f"{target} exists (use --overwrite)")
        print(export_pdf(deck, target))
    else:
        from .export.html import export_html, export_single

        if args.single:
            print(export_single(deck, out, name, overwrite=args.overwrite))
        else:
            print(export_html(deck, out, name, as_zip=args.zip, overwrite=args.overwrite))
    return 0


def _serve(args) -> int:
    import time
    import webbrowser

    from .server.thread import ServerThread

    server = ServerThread(load(), port=args.port).start()
    print(f"opendeck at {server.url}  (Ctrl+C to stop)")
    if args.browser:
        webbrowser.open(server.url)
    try:
        while server.thread.is_alive():
            time.sleep(0.5)
    except KeyboardInterrupt:
        server.stop()
    return 0


def _gui(args) -> int:
    from .shell.window import run

    return run(load(), deck=getattr(args, "deck", None))


def _publish(args) -> int:
    from .deck import publish, versioning

    config = load()
    if not config.publishing and not args.no_push and not args.remote:
        sys.exit("publishing is off: set publish_remote in the config file (or pass --remote / --no-push)")
    versioning.MIRROR_MEDIA = config.mirror_media
    commit, names, changed = publish.build(config.decks_root, config.mirror_root, config.publish_exclude,
                                           config.publish_title)
    print(f"{len(names)} decks in snapshot {commit[:7]}" + ("" if changed else " (unchanged)"))
    remote = args.remote or config.publish_remote
    if args.no_push or not remote:
        print("not pushed" + ("" if remote else ": no publish_remote in the config file"))
        return 0
    publish.push(config.mirror_root, remote)
    return 0


def _visibility(args) -> int:
    from .deck import publish
    from .paths import deck_dir

    config = load()
    if not config.publishing:
        sys.exit("publishing is off: set publish_remote in the config file to give decks a visibility")
    if args.deck is None:
        public = publish.public_decks(config.mirror_root)
        print("\n".join(public) if public else "every deck is private")
        return 0
    if args.state is None:
        sys.exit("say public or private")
    name = deck_dir(config, args.deck).name
    changed = publish.set_public(config.mirror_root, name, args.state == "public")
    print(f"{name}: {args.state}" + ("" if changed else " (already)"))
    return 0


def _install_desktop(args) -> int:
    from .shell.desktop import install_desktop_entry

    print(install_desktop_entry())
    return 0


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="opendeck", description="Local, offline slide decks.")
    parser.add_argument("--version", action="version", version=f"opendeck {__version__}")
    sub = parser.add_subparsers(dest="command")

    migrate = sub.add_parser("migrate", help="move decks out of slides.com").add_subparsers(
        dest="step", required=True)
    f = migrate.add_parser("fetch", help="download every deck as HTML zip + PDF via a logged-in Chrome")
    f.add_argument("--cdp", default="http://127.0.0.1:9222", help="DevTools endpoint of the logged-in Chrome")
    f.add_argument("--user", help="slides.com username (default: slidescom_user in the config file)")
    f.add_argument("--out", type=Path, help="download folder (default: <decks_root>/_inbox)")
    f.add_argument("--only", action="append", default=[], metavar="SLUG", help="only this deck (repeatable)")
    f.add_argument("--exclude", action="append", default=["capture-test"], metavar="SLUG",
                   help="skip this deck (repeatable; capture-test is always skipped unless named in --only)")
    f.add_argument("--allow", action="append", default=[], metavar="REGEX",
                   help="non-GET slides.com URL allowed outside --dry-run (repeatable)")
    f.add_argument("--dry-run", action="store_true",
                   help="log mutating requests instead of aborting them; use on a throwaway deck only")
    f.add_argument("--pause", type=float, default=30.0, help="seconds between decks")
    f.add_argument("--timeout", type=float, default=600.0, help="seconds to wait for one download")
    f.set_defaults(func=_migrate_fetch)

    mi = migrate.add_parser("import", help="import every zip in the inbox into the decks folder")
    mi.add_argument("--force", action="store_true", help="re-import decks already imported")
    mi.set_defaults(func=_migrate_import)
    mc = migrate.add_parser("census", help="inventory of block types, attributes and themes over all decks")
    mc.set_defaults(func=_migrate_census)

    imp = sub.add_parser("import", help="import one slides.com HTML export (zip or folder)")
    imp.add_argument("export", type=Path)
    imp.add_argument("--folder", help="deck folder name (default: YYYY-MM_<slug>)")
    imp.add_argument("--pdf", type=Path, help="the slides.com PDF of this deck, kept as reference")
    imp.add_argument("--force", action="store_true", help="replace a deck already imported")
    imp.set_defaults(func=_import)

    me = sub.add_parser("measure", help="black-box measure how slides.com exports render (theme facts)")
    me.add_argument("exports", type=Path, nargs="+", help="export zips or unpacked folders")
    me.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[2] / "web/src/render/theme/measured")
    me.set_defaults(func=_measure)

    ex = sub.add_parser("export", help="export a deck as PDF or HTML into a folder below export_root")
    ex.add_argument("kind", choices=["pdf", "html"])
    ex.add_argument("deck", type=Path, help="deck folder, or its name under the decks folder")
    ex.add_argument("--out", type=Path, required=True, help="destination folder (inside export_root)")
    ex.add_argument("--name", help="file or folder name (default: the deck folder name)")
    ex.add_argument("--zip", action="store_true", help="html: write one .zip instead of a folder")
    ex.add_argument("--single", action="store_true", help="html: one self-contained .html file (images inlined)")
    ex.add_argument("--overwrite", action="store_true")
    ex.set_defaults(func=_export)

    rg = sub.add_parser("regress", help="compare our PDF of each deck with its slides.com PDF")
    rg.add_argument("decks", type=Path, nargs="*", help="deck folders (default: every deck with a reference PDF)")
    rg.add_argument("--out", type=Path, help="report folder (default: <decks_root>/_reports/regress-YYYYMMDD)")
    rg.set_defaults(func=_regress)

    sv = sub.add_parser("serve", help="run the editor server only (open it in a browser)")
    sv.add_argument("--port", type=int, default=0, help="port on 127.0.0.1 (default: any free port)")
    sv.add_argument("--browser", action="store_true", help="open the default browser on it")
    sv.set_defaults(func=_serve)
    op = sub.add_parser("open", help="open the editor window (the default with no command)")
    op.add_argument("deck", nargs="?", help="deck folder name to open directly")
    op.set_defaults(func=_gui)

    pb = sub.add_parser("publish", help="snapshot every deck not in publish_exclude and push it to publish_remote")
    pb.add_argument("--remote", help="git remote URL (default: publish_remote from the config file)")
    pb.add_argument("--no-push", action="store_true", help="build the snapshot only")
    pb.set_defaults(func=_publish)

    vi = sub.add_parser("visibility", help="list the public decks, or make one public or private (default: private)")
    vi.add_argument("deck", nargs="?", help="deck folder name")
    vi.add_argument("state", nargs="?", choices=["public", "private"])
    vi.set_defaults(func=_visibility)

    sub.add_parser("install-desktop", help="add opendeck to the application menu").set_defaults(func=_install_desktop)

    args = parser.parse_args(argv)
    if args.command is None:
        args.func = _gui
    if getattr(args, "only", None):
        args.exclude = [s for s in args.exclude if s not in args.only]
    sys.exit(args.func(args))
