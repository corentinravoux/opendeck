// Loading and saving a deck must lose nothing.
//   1. untouched: serialize(parse(x)) === x, byte for byte;
//   2. every slide rebuilt from the model: same DOM as the original, and stable on a second pass;
//   3. an edit changes only the edited slide.
// Real decks: set OPENDECK_DECKS to a folder of opendeck decks (each <name>/index.html).
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDoc } from "../../src/model/parse";
import { serializeDoc } from "../../src/model/serialize";
import { setStyle } from "../../src/model/style";
import type { Doc, Item } from "../../src/model/types";

const SAMPLE = `
<section data-id="s1"><div class="sl-block" data-block-type="text" style="height: auto; width: 600px; left: 40px; top: 40px;" data-block-id="t1"><div class="sl-block-content" data-placeholder-tag="p" style="z-index: 10;"><p style="text-align:left"><span style="font-size:1.0em">Croissance « fσ<sub>8</sub> » — éàü &amp; x&nbsp;y</span></p></div></div>
<div class="sl-block" data-block-type="math" style="width: auto; height: auto; left: 100px; top: 200px;" data-block-id="m1"><div class="sl-block-content notranslate" style="z-index: 11; font-size: 60%;"><div class="math-input">\\lambda &lt; 1 + \\frac{a}{b}</div></div></div></section>
<section data-id="s2" data-background-color="#000000"><div class="sl-block" data-block-type="group" data-block-id="g1"><div class="sl-block-content sl-block-group-content" style="transform-origin: 1px 2px; z-index: 10;"><div class="sl-block" data-block-type="shape" style="width: 10px; height: 20px; left: 5px; top: 6px;" data-block-id="sh1"><div class="sl-block-style" style="z-index: 12; transform: rotate(30deg);"><div class="sl-block-content" data-shape-type="rect" style="z-index: 12;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20" preserveAspectRatio="none"><rect width="10" height="20" class="shape-element"></rect></svg></div></div></div></div></div></section>
`;

function canon(html: string): unknown {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const walk = (n: Node): unknown => {
    if (n.nodeType === 3) return n.textContent;
    if (n.nodeType !== 1) return null;
    const el = n as Element;
    const attrs = [...el.attributes].map((a) => {
      if (a.name === "style") return [a.name, a.value.split(";").map((d) => d.trim().replace(/\s*:\s*/, ":")).filter(Boolean).sort().join(";")];
      if (a.name === "class") return [a.name, a.value.split(/\s+/).filter(Boolean).sort().join(" ")];
      return [a.name, a.value];
    }).sort();
    return [el.tagName.toLowerCase(), attrs, [...el.childNodes].map(walk).filter((x) => x !== null)];
  };
  return [...tpl.content.childNodes].map(walk).filter((x) => x !== null && !(typeof x === "string" && !x.trim()));
}

function rebuildAll(doc: Doc): Doc {
  doc.slides.forEach((s) => (s.dirty = true));
  return doc;
}

function check(html: string) {
  expect(serializeDoc(parseDoc(html))).toBe(html);
  const rebuilt = serializeDoc(rebuildAll(parseDoc(html)));
  expect(canon(rebuilt)).toEqual(canon(html));
  expect(serializeDoc(rebuildAll(parseDoc(rebuilt)))).toBe(rebuilt);
}

describe("model round trip", () => {
  it("keeps a sample deck", () => check(SAMPLE));

  it("parses blocks, wrappers and groups", () => {
    const doc = parseDoc(SAMPLE);
    expect(doc.slides.map((s) => s.id)).toEqual(["s1", "s2"]);
    const blocks = doc.slides[0].items.filter((i): i is Extract<Item, { kind: "block" }> => i.kind === "block");
    expect(blocks.map((b) => b.block.type)).toEqual(["text", "math"]);
    expect(blocks[1].block.inner).toContain("\\lambda &lt; 1");
    const group = doc.slides[1].items.find((i) => i.kind === "block") as Extract<Item, { kind: "block" }>;
    expect(group.block.children?.length).toBe(1);
    const child = (group.block.children![0] as Extract<Item, { kind: "block" }>).block;
    expect(child.wrapper?.attrs.find(([k]) => k === "style")?.[1]).toContain("rotate(30deg)");
  });

  it("an edit only changes the edited slide", () => {
    const doc = parseDoc(SAMPLE);
    const block = (doc.slides[0].items[0] as Extract<Item, { kind: "block" }>).block;
    setStyle(block.outer, "left", "123px");
    doc.slides[0].dirty = true;
    const out = serializeDoc(doc);
    expect(out).toContain('left: 123px;');
    expect(out).toContain(doc.slides[1].source);
    expect(canon(out.replace("left: 123px", "left: 40px"))).toEqual(canon(SAMPLE));
  });
});

const ROOT = process.env.OPENDECK_DECKS;
const decks = ROOT && existsSync(ROOT)
  ? readdirSync(ROOT).filter((d: string) => !d.startsWith("_") && !d.startsWith(".") && existsSync(join(ROOT, d, "index.html")))
  : [];

describe.skipIf(decks.length === 0)("real decks", () => {
  for (const name of decks) {
    it(name, () => {
      const page = readFileSync(join(ROOT!, name, "index.html"), "utf8");
      const start = page.indexOf("<!-- od:slides:start -->") + "<!-- od:slides:start -->".length;
      const end = page.indexOf("<!-- od:slides:end -->");
      check(page.slice(start, end));
    });
  }
});
