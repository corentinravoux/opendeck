"""Import every downloaded export in the inbox."""

from __future__ import annotations

import json
from pathlib import Path

from ..importer.slidescom import import_export


def run(inbox: Path, decks_root: Path, mirror: Path, force: bool = False, log=print) -> int:
    listing = {d["slug"]: d for d in json.loads((inbox / "decks.json").read_text(encoding="utf-8"))}
    zips = sorted(inbox.glob("*.zip"))
    failures = 0
    for i, z in enumerate(zips, 1):
        slug = z.stem
        try:
            report = import_export(z, decks_root, listing=listing.get(slug),
                                   reference_pdf=inbox / f"{slug}.pdf", mirror=mirror, force=force)
        except FileExistsError:
            log(f"[{i}/{len(zips)}] {slug}: already imported")
            continue
        except Exception as exc:
            failures += 1
            log(f"[{i}/{len(zips)}] {slug}: FAILED {exc}")
            continue
        flags = []
        if report.missing_refs:
            flags.append(f"{len(report.missing_refs)} missing refs")
        if report.remote_refs:
            flags.append(f"{len(report.remote_refs)} remote refs")
        if report.unknown_blocks:
            flags.append(f"unknown blocks {report.unknown_blocks}")
        log(f"[{i}/{len(zips)}] {report.folder}: {report.slides} slides, {report.media_files} media"
            + (f"  ! {'; '.join(flags)}" if flags else ""))
    return failures
