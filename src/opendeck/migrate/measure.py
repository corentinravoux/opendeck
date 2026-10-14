"""Black-box measurement of how a slides.com export renders (see CLEANROOM.md).

The export is opened, as delivered, in headless Chrome, and its own runtime runs untouched. We then
record the computed styles of the rendered page. Probe elements are inserted for markup the deck
may not contain. The result is a JSON file of facts, from which our theme CSS is generated.
"""

from __future__ import annotations

import json
import tempfile
import zipfile
from contextlib import contextmanager
from pathlib import Path

PROPS = [
    "font-family", "font-size", "font-weight", "font-style", "line-height", "color", "letter-spacing",
    "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-left",
    "list-style-type", "list-style-position", "text-transform", "text-decoration-line", "vertical-align",
    "text-align", "word-wrap", "white-space", "background-color", "border-left-width", "border-left-style",
    "border-left-color", "display", "quotes", "font-variant-ligatures", "text-rendering", "font-kerning", "word-break", "overflow-wrap", "max-width", "hyphens",
]

PROBE_HTML = """
<h1 data-probe="h1">Probe</h1><h2 data-probe="h2">Probe</h2><h3 data-probe="h3">Probe</h3>
<h4 data-probe="h4">Probe</h4><h5 data-probe="h5">Probe</h5><h6 data-probe="h6">Probe</h6>
<p data-probe="p">Probe <a data-probe="a" href="#">link</a> <code data-probe="code">code</code>
<strong data-probe="strong">b</strong> <em data-probe="em">i</em> <s data-probe="s">s</s>
<u data-probe="u">u</u> x<sub data-probe="sub">2</sub> x<sup data-probe="sup">2</sup></p>
<ul data-probe="ul"><li data-probe="ul>li">one</li><li>two<ul data-probe="ul ul"><li data-probe="ul ul>li">nested</li></ul></li></ul>
<ol data-probe="ol"><li data-probe="ol>li">one</li></ol>
<blockquote data-probe="blockquote">quote</blockquote>
<pre data-probe="pre"><code>pre</code></pre>
"""

MEASURE_JS = """([props, probeHtml]) => {
  const cs = (el, pseudo) => { const s = getComputedStyle(el, pseudo || null);
    return Object.fromEntries(props.map(p => [p, s.getPropertyValue(p)])); };
  const out = { html_class: document.documentElement.className, body_class: document.body.className };
  out.reveal = cs(document.querySelector('.reveal'));
  const section = document.querySelector('.reveal .slides > section.present') || document.querySelector('.reveal .slides > section');
  out.section = cs(section);
  out.slide_number = [...document.querySelectorAll('.slide-number')].map(e => ({ text: e.innerText, style: Object.assign(cs(e),
    (({position, right, bottom, opacity, 'border-radius': r}) => ({position, right, bottom, opacity, 'border-radius': r}))(getComputedStyle(e))),
    rect: (r => ({ right: innerWidth - r.right, bottom: innerHeight - r.bottom, width: r.width, height: r.height }))(e.getBoundingClientRect()) }));
  out.blocks = {};
  for (const b of document.querySelectorAll('.reveal .slides .sl-block')) {
    const t = b.dataset.blockType; if (out.blocks[t]) continue;
    out.blocks[t] = cs(b.querySelector('.sl-block-content'));
  }
  // probe: an extra text block in the visible slide
  const block = document.createElement('div');
  block.className = 'sl-block'; block.dataset.blockType = 'text';
  block.style.cssText = 'left: 0px; top: 0px; width: 900px; height: auto;';
  block.innerHTML = '<div class="sl-block-content" style="z-index: 99;">' + probeHtml + '</div>';
  section.appendChild(block);
  const content = block.querySelector('.sl-block-content');
  out.probe_content = cs(content);
  out.tags = {};
  for (const el of block.querySelectorAll('[data-probe]')) {
    out.tags[el.dataset.probe] = cs(el);
    if (el.tagName === 'LI') out.tags[el.dataset.probe + '::marker'] = cs(el, '::marker');
  }
  block.remove();
  // probe: margins of an element that is alone in its block (first and last child at once)
  out.edges = {};
  for (const tag of ['ul', 'ol', 'p', 'h1', 'h2', 'blockquote']) {
    const solo = document.createElement('div');
    solo.className = 'sl-block'; solo.dataset.blockType = 'text';
    solo.style.cssText = 'left: 0px; top: 0px; width: 900px; height: auto;';
    const inner = tag === 'ul' || tag === 'ol' ? '<li>x</li>' : 'x';
    solo.innerHTML = '<div class="sl-block-content"><' + tag + '>' + inner + '</' + tag + '></div>';
    section.appendChild(solo);
    const el = solo.querySelector(tag), s = getComputedStyle(el);
    out.edges[tag] = { margin_top: s.marginTop, margin_bottom: s.marginBottom,
                       content_height: solo.querySelector('.sl-block-content').getBoundingClientRect().height,
                       element_height: el.getBoundingClientRect().height };
    solo.remove();
  }
  const katex = document.querySelector('.reveal .slides [data-block-type=math] .katex');
  if (katex) {
    const content = katex.closest('.sl-block-content');
    out.math = { block: cs(content.closest('.sl-block')), content: cs(content), katex: cs(katex),
                 content_inline_font_size: content.style.fontSize,
                 display: !!content.querySelector('.katex-display'),
                 data_math_display: content.getAttribute('data-math-display') };
  }
  return out; }"""


@contextmanager
def export_folder(src: Path):
    """The export as a folder: itself, or a temporary unpacked copy of a zip."""
    if src.is_dir():
        yield src
        return
    with tempfile.TemporaryDirectory(prefix="opendeck-measure-") as tmp:
        zipfile.ZipFile(src).extractall(tmp)
        index = sorted(Path(tmp).rglob("index.html"), key=lambda p: len(p.parts))[0]
        yield index.parent


def measure(src: Path, settle_ms: int = 4000) -> dict:
    from playwright.sync_api import sync_playwright

    with export_folder(src) as folder, sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 576})
        page.goto((folder / "index.html").as_uri())
        page.wait_for_timeout(settle_ms)
        result = page.evaluate(MEASURE_JS, [PROPS, PROBE_HTML])
        browser.close()
    result["source"] = src.name
    return result


def run(sources: list[Path], out_dir: Path, log=print) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for src in sources:
        result = measure(src)
        theme = "-".join(c.removeprefix("theme-font-").removeprefix("theme-color-")
                         for c in result["body_class"].split() if c.startswith("theme-"))
        target = out_dir / f"{theme or 'unknown'}.json"
        target.write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        log(f"{src.name}: {theme} -> {target}")
