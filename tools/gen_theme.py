"""Generate web/src/render/theme/presets.css from the measured JSON files.

Each web/src/render/theme/measured/<font>-<color>.json was written by `opendeck measure` from
an export rendered as delivered. This script turns those facts into our own CSS:

- typography under .theme-font-<font>: em ratios, so block font-size scaling keeps working;
- colours under .theme-color-<color>.

Usage: python tools/gen_theme.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MEASURED = ROOT / "web/src/render/theme/measured"
OUT = ROOT / "web/src/render/theme/presets.css"

# probe name -> (CSS selector inside .sl-block-content, probe name of the parent element)
TAGS = {
    "h1": ("h1", None), "h2": ("h2", None), "h3": ("h3", None),
    "h4": ("h4", None), "h5": ("h5", None), "h6": ("h6", None),
    "p": ("p", None), "a": ("a", "p"), "code": ("code", "p"), "strong": ("strong, b", "p"),
    "em": ("em, i", "p"), "s": ("s, strike, del", "p"), "u": ("u", "p"),
    "sub": ("sub", "p"), "sup": ("sup", "p"),
    "ul": ("ul", None), "ul ul": ("ul ul", "ul>li"), "ol": ("ol", None),
    "ul>li": ("li", "ul"), "blockquote": ("blockquote", None), "pre": ("pre", None),
}
INLINE = {"a", "code", "strong", "em", "s", "u", "sub", "sup"}


def px(value: str) -> float:
    m = re.fullmatch(r"(-?[\d.]+)px", value.strip())
    if not m:
        raise ValueError(f"not a px value: {value!r}")
    return float(m.group(1))


def em(value: float) -> str:
    return f"{round(value, 4):g}em" if value else "0"


def ratio(value: float) -> str:
    return f"{round(value, 4):g}"


def font_rules(font: str, m: dict) -> list[str]:
    base = m["probe_content"]
    base_size = px(base["font-size"])
    sel = f".theme-font-{font}"
    rules = [
        f"{sel} .reveal {{ font-family: {m['reveal']['font-family']}; font-size: {base_size:g}px; "
        f"text-rendering: {base.get('text-rendering', 'auto')}; font-kerning: {base.get('font-kerning', 'auto')}; }}",
        f"{sel} .reveal .slides > section {{ line-height: {ratio(px(m['section']['line-height']) / base_size)}; }}",
        f"{sel} .sl-block-content {{ line-height: {ratio(px(base['line-height']) / base_size)}; }}",
    ]
    for probe, (css, parent) in TAGS.items():
        s = m["tags"].get(probe)
        if not s:
            continue
        p = m["tags"][parent] if parent else base  # what the element would inherit
        size, parent_size = px(s["font-size"]), px(p["font-size"])
        inline = probe in INLINE
        decl = []
        for prop in ("font-family", "font-weight", "font-style", "text-transform"):
            # block tags always: the browser's own stylesheet makes h1-h6 bold
            if s[prop] != p[prop] or (not inline and prop in ("font-weight", "font-style")):
                decl.append(f"{prop}: {s[prop]}")
        if size != parent_size:
            decl.append(f"font-size: {em(size / parent_size)}")
        own_lh = ratio(px(s["line-height"]) / size)
        if own_lh != ratio(px(p["line-height"]) / parent_size):  # equal ratio = inherited
            decl.append(f"line-height: {own_lh}")
        if not inline:
            margins = [em(px(s[f"margin-{side}"]) / size) for side in ("top", "right", "bottom", "left")]
            decl.append(f"margin: {' '.join(margins)}")
            decl.append(f"padding: {em(px(s['padding-top']) / size)} 0 0 {em(px(s['padding-left']) / size)}")
        if probe in ("ul", "ul ul", "ol"):
            decl.append(f"list-style-type: {s['list-style-type']}")
        if s["text-decoration-line"] != p["text-decoration-line"]:
            decl.append(f"text-decoration-line: {s['text-decoration-line']}")
        if s["vertical-align"] != "baseline":
            decl.append(f"vertical-align: {s['vertical-align']}")
        if s["letter-spacing"] != p["letter-spacing"]:
            decl.append(f"letter-spacing: {em(px(s['letter-spacing']) / size)}")
        if probe in ("ul", "ul ul", "ol") or (not inline and s["display"] not in ("block", "list-item")):
            decl.append(f"display: {s['display']}")  # nested lists must not inherit the outer rule
        if not inline and s.get("max-width", "none") != "none":
            decl.append(f"max-width: {s['max-width']}")  # caps inline-block lists so long words break
        if not inline and s["text-align"] != p["text-align"]:
            decl.append(f"text-align: {s['text-align']}")
        if not decl:
            continue
        selectors = ", ".join(f"{sel} .sl-block-content {c.strip()}" for c in css.split(","))
        rules.append(f"{selectors} {{ {'; '.join(decl)}; }}")
    edges = m.get("edges", {})
    if edges and all(px(e["margin_top"]) == 0 for e in edges.values()):
        rules.append(f"{sel} .sl-block-content > :first-child {{ margin-top: 0; }}")
    if edges and all(px(e["margin_bottom"]) == 0 for e in edges.values()):
        rules.append(f"{sel} .sl-block-content > :last-child {{ margin-bottom: 0; }}")
    math = m.get("math")
    if math:
        # A math block's percentage font-size applies to a larger base than text blocks, and
        # KaTeX runs at 1em of the block (not KaTeX's stock 1.21em).
        content_px = px(math["content"]["font-size"])
        block_px = px(math["block"]["font-size"])
        katex = math["katex"]
        rules.append(f'{sel} .sl-block[data-block-type="math"] {{ font-size: {block_px:g}px; }}')
        rules.append(f'{sel} .sl-block[data-block-type="math"] .sl-block-content {{ '
                     f'line-height: {ratio(px(math["content"]["line-height"]) / content_px)}; }}')
        rules.append(f"{sel} .sl-block .math-output .katex {{ "
                     f"font-size: {em(px(katex['font-size']) / content_px)}; "
                     f"line-height: {ratio(px(katex['line-height']) / px(katex['font-size']))}; }}")
    return rules


def color_rules(color: str, m: dict) -> list[str]:
    sel = f".theme-color-{color}"
    text = m["probe_content"]["color"]
    link = m["tags"]["a"]["color"]
    rules = [
        f"{sel} {{ background: #fff; }}",
        f"{sel} .reveal {{ color: {text}; }}",
        f"{sel} .sl-block-content a {{ color: {link}; }}",
    ]
    for item in m.get("slide_number", [])[:1]:
        s = item["style"]
        rules.append(f"{sel} .od-slide-number {{ color: {s['color']}; background-color: {s['background-color']}; }}")
    return rules


def main() -> None:
    out = ["/* GENERATED by tools/gen_theme.py from theme/measured/*.json. Do not edit. */"]
    for path in sorted(MEASURED.glob("*.json")):
        m = json.loads(path.read_text(encoding="utf-8"))
        font = next(c.removeprefix("theme-font-") for c in m["body_class"].split() if c.startswith("theme-font-"))
        color = next(c.removeprefix("theme-color-") for c in m["body_class"].split() if c.startswith("theme-color-"))
        out.append(f"\n/* {path.name}: measured from {m['source']} */")
        out += font_rules(font, m) + color_rules(color, m)
    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
