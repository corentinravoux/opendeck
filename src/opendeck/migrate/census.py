"""Inventory of all imported decks: what the renderer and editor must support."""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from ..deck import template


def scan(decks_root: Path) -> dict:
    decks, blocks, attrs, themes, sizes, features = [], Counter(), Counter(), Counter(), Counter(), Counter()
    shapes, line_ends, remote = Counter(), Counter(), []
    for index in sorted(decks_root.glob("*/index.html")):
        try:
            meta, slides = template.read(index.read_text(encoding="utf-8"))
        except ValueError:
            continue
        report_path = index.parent / ".opendeck" / "import-report.json"
        report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.is_file() else {}
        decks.append({"folder": index.parent.name, "title": meta.title, "slides": report.get("slides"),
                      "size": f"{meta.width}x{meta.height}"})
        themes[f"v{meta.source.get('version')} {meta.theme_font}/{meta.theme_color}"] += 1
        sizes[f"{meta.width}x{meta.height}"] += 1
        blocks.update(re.findall(r'data-block-type="([a-z-]+)"', slides))
        attrs.update(re.findall(r"\s(data-[a-z0-9-]+)=", slides))
        shapes.update(re.findall(r'data-shape-type="([^"]+)"', slides))
        line_ends.update(re.findall(r'data-line-(?:start|end)-type="([^"]+)"', slides))
        for k, v in report.get("features", {}).items():
            features[k] += v
        remote += [f"{index.parent.name}: {r}" for r in report.get("remote_refs", [])]
    return {
        "decks": decks, "themes": dict(themes), "sizes": dict(sizes),
        "blocks": dict(blocks.most_common()), "shapes": dict(shapes.most_common()),
        "line_caps": dict(line_ends.most_common()), "features": dict(features),
        "data_attributes": dict(attrs.most_common()), "remote_refs": remote,
    }


def run(decks_root: Path, out: Path, log=print) -> dict:
    result = scan(decks_root)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    log(f"{len(result['decks'])} decks, {sum(d['slides'] or 0 for d in result['decks'])} slides -> {out}")
    for key in ("themes", "sizes", "blocks", "shapes", "line_caps", "features"):
        log(f"  {key}: {result[key]}")
    log(f"  remote refs: {len(result['remote_refs'])}")
    return result
