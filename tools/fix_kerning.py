"""Rebuild the kerning of the legacy fonts in web/fonts-legacy/ as a GPOS 'kern' feature.

Open Sans 1.10 as published in google/fonts keeps its kerning in a legacy 'kern' table whose
single subtable (18 694 pairs) overflows the 16-bit length field. Chrome's font sanitiser drops
it, so the font renders unkerned and lines come out about 0.4 % wider than the same font as
served to slides.com decks (which kern "To", "AV", "y," …). This script copies each pair into a
GPOS PairPos lookup and writes <name>-kern.ttf next to the original. The kerning values are
unchanged (checked against the kerning a slides.com export applies).

Usage: python tools/fix_kerning.py      (needs fontTools)
"""

from __future__ import annotations

from pathlib import Path

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.ttLib import TTFont

FONTS = Path(__file__).resolve().parents[1] / "web" / "fonts-legacy"


def has_gpos_kern(font: TTFont) -> bool:
    if "GPOS" not in font or not font["GPOS"].table.FeatureList:
        return False
    return any(r.FeatureTag == "kern" for r in font["GPOS"].table.FeatureList.FeatureRecord)


def kern_pairs(font: TTFont) -> dict[tuple[str, str], int]:
    pairs: dict[tuple[str, str], int] = {}
    for sub in font["kern"].kernTables:
        for (a, b), value in sub.kernTable.items():
            if value:
                pairs.setdefault((a, b), value)
    return pairs


def rebuild(src: Path) -> Path | None:
    font = TTFont(src)
    if "kern" not in font or has_gpos_kern(font):
        return None
    pairs = kern_pairs(font)
    if "GPOS" in font:
        del font["GPOS"]
    lines = [f"  pos \\{a} \\{b} {v};" for (a, b), v in sorted(pairs.items())]
    fea = "languagesystem DFLT dflt;\nlanguagesystem latn dflt;\n\nfeature kern {\n" + "\n".join(lines) + "\n} kern;\n"
    addOpenTypeFeaturesFromString(font, fea)
    del font["kern"]
    out = src.with_name(f"{src.stem}-kern.ttf")
    font.save(out)
    return out


def main() -> None:
    for src in sorted(FONTS.glob("*.ttf")):
        if src.stem.endswith("-kern"):
            continue
        out = rebuild(src)
        print(f"{src.name}: {'-> ' + out.name if out else 'kept (no legacy kern table, or GPOS kern already present)'}")


if __name__ == "__main__":
    main()
