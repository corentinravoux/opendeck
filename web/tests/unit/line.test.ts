// Line SVG against real slides.com output (goldens copied from imported decks), and, with
// OPENDECK_DECKS set, against every straight or curved line of every deck.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lineSvg, type LineSpec } from "../../src/render/line";

function pathD(svg: string, cls: string): string | null {
  const tag = [...svg.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`class="${cls}"`));
  return tag ? (/\sd="([^"]*)"/.exec(tag)?.[1] ?? null) : null;
}

const nums = (d: string | null) => (d?.match(/-?[\d.]+/g) ?? []).map(Number);

function close(a: string | null, b: string | null, tol = 0.01) {
  const x = nums(a), y = nums(b);
  expect(x.length).toBe(y.length);
  x.forEach((v, i) => expect(Math.abs(v - y[i])).toBeLessThanOrEqual(tol));
}

const spec = (o: Partial<LineSpec>): LineSpec => ({ x1: 0, y1: 0, x2: 0, y2: 0, color: "#000000", width: 2, start: "none", end: "none", style: "solid-rounded", c: 0, ...o });

describe("line geometry (goldens from real decks)", () => {
  it("line-arrow end, rounded", () => {
    const svg = lineSvg(spec({ x2: 4, y2: 49, end: "line-arrow", color: "#6aa84f" }));
    close(pathD(svg, "line-element"), "M0 0 L3.837 47.007");
    close(pathD(svg, "line-end"), "M 9.431 41.782 L 3.939 48.251 L -2.529 42.759 L 3.939 48.251");
  });
  it("line-arrow start, rounded", () => {
    const svg = lineSvg(spec({ y1: 45.29, x2: 121.5, start: "line-arrow" }));
    close(pathD(svg, "line-element"), "M1.874 44.591 L121.5 0");
    close(pathD(svg, "line-start"), "M 4.231 37.31 L 0.705 45.027 L 8.422 48.554 L 0.705 45.027");
  });
  it("filled arrow start", () => {
    const svg = lineSvg(spec({ y1: 36, x2: 85.5, start: "arrow" }));
    close(pathD(svg, "line-element"), "M4.608 34.06 L85.5 0");
    close(pathD(svg, "line-start"), "M 5.821 29.209 L 0 36 L 8.925 36.582");
  });
  it("curved line: sagitta to arc radius", () => {
    const svg = lineSvg(spec({ x1: 124, x2: 0, y2: 76.371, c: 19 }));
    expect(pathD(svg, "line-skeleton")).toMatch(/^M124 0 A149\.0\d+ 149\.0\d+ 0 0 0 0 76\.371$/);
  });
});

const ROOT = process.env.OPENDECK_DECKS;
const decks = ROOT && existsSync(ROOT) ? readdirSync(ROOT).filter((d: string) => existsSync(join(ROOT, d, "index.html"))) : [];

describe.skipIf(decks.length === 0)("every modern line of the real decks", () => {
  it("matches slides.com's line-element and heads", () => {
    let checked = 0;
    const misses: string[] = [];
    for (const d of decks) {
      const page = readFileSync(join(ROOT!, d, "index.html"), "utf8");
      for (const m of page.matchAll(/<div class="sl-block-content"([^>]*data-line-x1[^>]*)>(<svg.*?<\/svg>)/gs)) {
        const a = m[1], svg = m[2];
        if (!svg.includes('class="line-skeleton"')) continue; // the older <line> format is kept as is
        const g = (k: string) => new RegExp(`${k}="([^"]*)"`).exec(a)?.[1] ?? null;
        const s: LineSpec = {
          x1: +g("data-line-x1")!, y1: +g("data-line-y1")!, x2: +g("data-line-x2")!, y2: +g("data-line-y2")!,
          color: g("data-line-color") ?? "#000000", width: parseFloat(g("data-line-width") ?? "2"),
          start: g("data-line-start-type") ?? "none", end: g("data-line-end-type") ?? "none",
          style: g("data-line-style"), c: +(g("data-line-c") ?? 0),
        };
        const ours = lineSvg(s);
        for (const cls of ["line-element", "line-start", "line-end"]) {
          // arcs: compare end points, not the radius (slides.com redraws a shortened arc slightly differently)
          const pts = (d: string | null) => (s.c && cls === "line-element" ? nums(d).filter((_, i) => ![2, 3].includes(i)) : nums(d));
          const x = pts(pathD(ours, cls)), y = pts(pathD(svg, cls));
          const tol = 0.02;
          const ok = x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) <= tol);
          if (!ok) misses.push(`${d} ${cls}: ours ${pathD(ours, cls)} vs ${pathD(svg, cls)} (${JSON.stringify(s)})`);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(misses.slice(0, 5)).toEqual([]);
  });
});

describe("shape geometry (goldens from real decks)", async () => {
  const { shapeSvg } = await import("../../src/render/shape");
  const base = { fill: "#000000", stroke: null, strokeWidth: 0, radius: 0 };
  it("arrow-up and arrow-right polygons", () => {
    expect(shapeSvg({ ...base, type: "arrow-up", width: 10, height: 18 }, "x")).toContain('points="5,0 10,9 7,9 7,18 3,18 3,9 0,9 5,0"');
    expect(shapeSvg({ ...base, type: "arrow-right", width: 67, height: 26 }, "x")).toContain('points="0,7.8 33.5,7.8 33.5,0 67,13 33.5,26 33.5,18.2 0,18.2"');
  });
  it("ellipse and bordered rect (inner stroke via clip path)", () => {
    expect(shapeSvg({ ...base, type: "circle", width: 10, height: 10 }, "x")).toContain('<ellipse rx="5" ry="5" cx="5" cy="5" class="shape-element" fill="#000000">');
    const svg = shapeSvg({ ...base, type: "rect", width: 275, height: 79, fill: "rgba(0, 0, 0, 0)", stroke: "#ff0000", strokeWidth: 2 }, "c1");
    expect(svg).toContain('<clipPath id="c1"><rect width="275" height="79" rx="0" ry="0" fill="rgba(0, 0, 0, 0)" stroke="#ff0000" stroke-width="4"></rect></clipPath>');
    expect(svg).toContain('class="shape-element" fill="rgba(0, 0, 0, 0)" stroke="#ff0000" stroke-width="4" clip-path="url(#c1)"');
  });
});
