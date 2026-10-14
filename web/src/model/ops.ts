// Editing operations on the model. They mutate in place, and are meant to run inside an Immer
// producer so that every change is recorded for undo. Each marks the slides it touches dirty.
import { lineSvg, type LineSpec } from "../render/line";
import { shapeSvg, type ShapeSpec } from "../render/shape";
import { getAttr, getStyle, setAttr, setStyle } from "./style";
import type { Block, Doc, Item, Slide } from "./types";

export const blocksOf = (items: Item[]): Block[] =>
  items.filter((i): i is Extract<Item, { kind: "block" }> => i.kind === "block").map((i) => i.block);

/** All blocks of a slide, group children included (depth-first). */
export function allBlocks(items: Item[]): Block[] {
  return blocksOf(items).flatMap((b) => [b, ...(b.children ? allBlocks(b.children) : [])]);
}

export function findBlock(slide: Slide, id: string): Block | undefined {
  return allBlocks(slide.items).find((b) => b.id === id);
}

const px = (v: string | null): number | null => {
  const m = v ? /^(-?[\d.]+)px$/.exec(v.trim()) : null;
  return m ? parseFloat(m[1]) : null;
};
const fmt = (n: number) => `${Math.round(n * 1000) / 1000}px`;

export interface Frame { left: number; top: number; width: number | null; height: number | null }

export function frame(b: Block): Frame {
  return {
    left: px(getStyle(b.outer, "left")) ?? 0,
    top: px(getStyle(b.outer, "top")) ?? 0,
    width: px(getStyle(b.outer, "width")),
    height: px(getStyle(b.outer, "height")),
  };
}

/** Move a block by (dx, dy) slide pixels; a group moves its children (they hold absolute coordinates). */
export function moveBlock(b: Block, dx: number, dy: number): void {
  if (b.type === "group" && b.children) {
    for (const child of blocksOf(b.children)) moveBlock(child, dx, dy);
    return;
  }
  const f = frame(b);
  setStyle(b.outer, "left", fmt(f.left + dx));
  setStyle(b.outer, "top", fmt(f.top + dy));
}

/** Set position and (numeric) size; null leaves a dimension as it is (e.g. height: auto). */
export function setFrame(b: Block, f: Partial<Frame>): void {
  if (f.left !== undefined) setStyle(b.outer, "left", fmt(f.left));
  if (f.top !== undefined) setStyle(b.outer, "top", fmt(f.top));
  if (f.width != null) setStyle(b.outer, "width", fmt(Math.max(1, f.width)));
  if (f.height != null) setStyle(b.outer, "height", fmt(Math.max(1, f.height)));
  if (b.type === "shape" && (f.width != null || f.height != null) && !(getAttr(b.content, "data-shape-type") ?? "").startsWith("symbol-")) {
    setShape(b, {});
  }
  if (b.type === "image" && (f.width != null || f.height != null) && b.inner.includes("data-crop-width")) {
    applyCrop(b, imageCrop(b));
  }
}

export function zIndex(b: Block): number {
  return Number(getStyle(b.content, "z-index") ?? 0) || 0;
}

/** Write a z-index where the block keeps it: on the content, and on the wrapper if any. */
export function setZIndex(b: Block, z: number): void {
  setStyle(b.content, "z-index", String(z));
  if (b.wrapper) setStyle(b.wrapper, "z-index", String(z));
}

export type ZMove = "front" | "back" | "forward" | "backward";

/** Reorder the top-level blocks of a slide and renumber their z-index densely from 10. */
export function reorder(slide: Slide, ids: string[], move: ZMove): void {
  const order = blocksOf(slide.items).sort((a, b) => zIndex(a) - zIndex(b));
  const chosen = new Set(ids);
  let next = order;
  if (move === "front") next = [...order.filter((b) => !chosen.has(b.id)), ...order.filter((b) => chosen.has(b.id))];
  else if (move === "back") next = [...order.filter((b) => chosen.has(b.id)), ...order.filter((b) => !chosen.has(b.id))];
  else {
    next = [...order];
    const step = move === "forward" ? 1 : -1;
    const idx = next.map((b, i) => (chosen.has(b.id) ? i : -1)).filter((i) => i >= 0);
    for (const i of step > 0 ? idx.reverse() : idx) {
      const j = i + step;
      if (j < 0 || j >= next.length || chosen.has(next[j].id)) continue;
      [next[i], next[j]] = [next[j], next[i]];
    }
  }
  next.forEach((b, i) => setZIndex(b, 10 + i));
  slide.dirty = true;
}

/** Remove top-level blocks (and their children). */
export function removeBlocks(slide: Slide, ids: string[]): void {
  const gone = new Set(ids);
  slide.items = slide.items.filter((i) => !(i.kind === "block" && gone.has(i.block.id)));
  slide.dirty = true;
}

export function newId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function cloneWithNewIds(b: Block): Block {
  const copy: Block = JSON.parse(JSON.stringify(b)); // plain data; works on Immer drafts too
  const renew = (x: Block) => {
    x.id = newId();
    setAttr(x.outer, "data-block-id", x.id);
    if (x.children) blocksOf(x.children).forEach(renew);
  };
  renew(copy);
  return copy;
}

/** Duplicate top-level blocks, offset by (dx, dy), on top of everything; returns the new ids. */
export function duplicateBlocks(slide: Slide, ids: string[], dx = 0, dy = 0): string[] {
  const top = Math.max(9, ...blocksOf(slide.items).map(zIndex));
  const made: string[] = [];
  blocksOf(slide.items).filter((b) => ids.includes(b.id)).forEach((b, k) => {
    const copy = cloneWithNewIds(b);
    if (dx || dy) moveBlock(copy, dx, dy);
    setZIndex(copy, top + 1 + k);
    slide.items.push({ kind: "block", block: copy });
    made.push(copy.id);
  });
  slide.dirty = true;
  return made;
}

/** Rotation in degrees, as slides.com stores it: transform: rotate(Ndeg) on the .sl-block-style wrapper. */
export function rotation(b: Block): number {
  const t = b.wrapper ? getStyle(b.wrapper, "transform") ?? "" : "";
  const m = /rotate\((-?[\d.]+)deg\)/.exec(t);
  return m ? parseFloat(m[1]) : 0;
}

export function setRotation(b: Block, deg: number): void {
  const value = `rotate(${Math.round(deg * 100) / 100}deg)`;
  if (!b.wrapper) {
    const z = getStyle(b.content, "z-index");
    b.wrapper = { tag: "div", attrs: [["class", "sl-block-style"], ["style", z ? `z-index: ${z};` : ""]] };
    if (!z) setAttr(b.wrapper, "style", null);
  }
  const t = getStyle(b.wrapper, "transform") ?? "";
  setStyle(b.wrapper, "transform", /rotate\(/.test(t) ? t.replace(/rotate\([^)]*\)/, value) : (t ? `${t} ${value}` : value));
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** TeX source of a math block (from its .math-input). */
export function mathTex(b: Block): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = b.inner;
  return tpl.content.querySelector(".math-input")?.textContent ?? "";
}

export function setMathTex(b: Block, tex: string): void {
  b.inner = `<div class="math-input">${escHtml(tex)}</div>`;
}

/** font-size of the content in %, as slides.com stores the "Scale" of math and text blocks. */
export function contentScale(b: Block): number {
  const v = getStyle(b.content, "font-size");
  const m = v ? /^([\d.]+)%$/.exec(v) : null;
  return m ? parseFloat(m[1]) : 100;
}

export function setContentScale(b: Block, percent: number): void {
  setStyle(b.content, "font-size", percent === 100 ? null : `${Math.round(percent)}%`);
}

/** Fill colour of a shape: data attribute plus the fill of its SVG element(s). */
export function setShapeFill(b: Block, color: string): void {
  setAttr(b.content, "data-shape-fill-color", color);
  const tpl = document.createElement("template");
  tpl.innerHTML = b.inner;
  for (const el of tpl.content.querySelectorAll(".shape-element")) el.setAttribute("fill", color);
  b.inner = tpl.innerHTML;
}

export function attr(shell: Block["content"], name: string): string | null {
  return getAttr(shell, name);
}

// --- slides -------------------------------------------------------------------------------


function freshSlide(attrs: [string, string][], items: Item[]): Slide {
  const id = newId() + newId(); // 24 hex, like slides.com's 32/12-hex ids: unique and opaque
  const a = attrs.filter(([k]) => k !== "data-id");
  return { id, attrs: [["data-id", id], ...a], items, source: "", dirty: true, before: "\n" };
}

/** Insert an empty slide after index `at`; returns its index. */
export function addSlide(doc: Doc, at: number): number {
  doc.slides.splice(at + 1, 0, freshSlide([], []));
  return at + 1;
}

/** Duplicate slide `at` (blocks get new ids); returns the new index. */
export function duplicateSlide(doc: Doc, at: number): number {
  const src = doc.slides[at];
  const items: Item[] = JSON.parse(JSON.stringify(src.items));
  const renew = (list: Item[]) => list.forEach((it) => {
    if (it.kind !== "block") return;
    it.block.id = newId();
    setAttr(it.block.outer, "data-block-id", it.block.id);
    if (it.block.children) renew(it.block.children);
  });
  renew(items);
  doc.slides.splice(at + 1, 0, freshSlide(src.attrs.map(([k, v]) => [k, v]), items));
  return at + 1;
}

export function removeSlide(doc: Doc, at: number): void {
  if (doc.slides.length > 1) doc.slides.splice(at, 1);
}

export function moveSlide(doc: Doc, from: number, to: number): void {
  const [s] = doc.slides.splice(from, 1);
  doc.slides.splice(Math.max(0, Math.min(doc.slides.length, to)), 0, s);
}

/** Insert slides given as HTML after index `at` (new slide and block ids); returns the first new index. */
export function insertSlides(doc: Doc, at: number, sources: Slide[]): number {
  sources.forEach((src, k) => {
    const items = src.items.map((it) => (it.kind === "block" ? { kind: "block" as const, block: cloneWithNewIds(it.block) } : it));
    doc.slides.splice(at + 1 + k, 0, freshSlide(src.attrs.map(([a, v]) => [a, v]), items));
  });
  return at + 1;
}

// --- groups -------------------------------------------------------------------------------

/** Group top-level blocks; children keep their absolute slide coordinates. Returns the group id. */
export function groupBlocks(slide: Slide, ids: string[]): string | null {
  const chosen = blocksOf(slide.items).filter((b) => ids.includes(b.id)).sort((a, b) => zIndex(a) - zIndex(b));
  if (chosen.length < 2) return null;
  const frames = chosen.map(frame).filter((f) => f.width !== null && f.height !== null);
  const id = newId();
  const z = Math.max(...chosen.map(zIndex));
  const contentStyle: string[] = [];
  if (frames.length) {
    const l = Math.min(...frames.map((f) => f.left)), t = Math.min(...frames.map((f) => f.top));
    const r = Math.max(...frames.map((f) => f.left + f.width!)), b = Math.max(...frames.map((f) => f.top + f.height!));
    contentStyle.push(`transform-origin: ${Math.round((l + r) / 2 * 1000) / 1000}px ${Math.round((t + b) / 2 * 1000) / 1000}px;`);
  }
  contentStyle.push(`z-index: ${z};`);
  const group: Block = {
    id, type: "group",
    outer: { tag: "div", attrs: [["class", "sl-block sl-block-group"], ["data-block-type", "group"], ["data-block-id", id]] },
    wrapper: null,
    content: { tag: "div", attrs: [["class", "sl-block-content sl-block-group-content"], ["style", contentStyle.join(" ")]] },
    inner: "",
    children: chosen.map((block) => ({ kind: "block" as const, block })),
    extras: "",
  };
  const at = slide.items.findIndex((i) => i.kind === "block" && i.block.id === chosen[chosen.length - 1].id);
  slide.items = slide.items.filter((i) => !(i.kind === "block" && ids.includes(i.block.id)));
  slide.items.splice(Math.min(at, slide.items.length), 0, { kind: "block", block: group });
  slide.dirty = true;
  return id;
}

/** Replace a group by its children; returns their ids. */
export function ungroupBlock(slide: Slide, id: string): string[] {
  const at = slide.items.findIndex((i) => i.kind === "block" && i.block.id === id);
  if (at < 0) return [];
  const g = (slide.items[at] as Extract<Item, { kind: "block" }>).block;
  if (g.type !== "group" || !g.children) return [];
  slide.items.splice(at, 1, ...g.children);
  slide.dirty = true;
  return blocksOf(g.children).map((b) => b.id);
}

/** Set (or remove, with null) an attribute of the slide's <section>, e.g. data-background-color. */
export function setSlideAttr(slide: Slide, name: string, value: string | null): void {
  const i = slide.attrs.findIndex(([k]) => k === name);
  if (value === null) { if (i >= 0) slide.attrs.splice(i, 1); }
  else if (i >= 0) slide.attrs[i] = [name, value];
  else slide.attrs.push([name, value]);
  slide.dirty = true;
}

// --- lines --------------------------------------------------------------------------------


export function lineSpec(b: Block): LineSpec {
  const g = (k: string) => getAttr(b.content, k);
  return {
    x1: +(g("data-line-x1") ?? 0), y1: +(g("data-line-y1") ?? 0), x2: +(g("data-line-x2") ?? 0), y2: +(g("data-line-y2") ?? 0),
    color: g("data-line-color") ?? "#000000", width: parseFloat(g("data-line-width") ?? "2"),
    start: g("data-line-start-type") ?? "none", end: g("data-line-end-type") ?? "none",
    style: g("data-line-style"), c: +(g("data-line-c") ?? 0),
  };
}

/** Absolute (slide) end points of a line block. */
export function lineEnds(b: Block): { p1: [number, number]; p2: [number, number] } {
  const f = frame(b), s = lineSpec(b);
  return { p1: [f.left + s.x1, f.top + s.y1], p2: [f.left + s.x2, f.top + s.y2] };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Rewrite a line from absolute end points and settings; the block is moved to the line's box. */
export function setLine(b: Block, p1: [number, number], p2: [number, number], patch: Partial<LineSpec> = {}): void {
  const old = lineSpec(b);
  const left = Math.min(p1[0], p2[0]), top = Math.min(p1[1], p2[1]);
  const spec: LineSpec = { ...old, ...patch, x1: r3(p1[0] - left), y1: r3(p1[1] - top), x2: r3(p2[0] - left), y2: r3(p2[1] - top) };
  setStyle(b.outer, "left", `${r3(left)}px`);
  setStyle(b.outer, "top", `${r3(top)}px`);
  const set = (k: string, v: string | null) => setAttr(b.content, k, v);
  set("data-line-x1", String(spec.x1)); set("data-line-y1", String(spec.y1));
  set("data-line-x2", String(spec.x2)); set("data-line-y2", String(spec.y2));
  set("data-line-color", spec.color); set("data-line-width", `${spec.width}px`);
  set("data-line-start-type", spec.start); set("data-line-end-type", spec.end);
  set("data-line-style", spec.style);
  if (getAttr(b.content, "data-line-c") !== null || spec.c) set("data-line-c", String(spec.c));
  b.inner = lineSvg(spec);
}

// --- shapes -------------------------------------------------------------------------------


export function shapeSpec(b: Block): ShapeSpec {
  const g = (k: string) => getAttr(b.content, k);
  const fr = frame(b);
  return {
    type: g("data-shape-type") ?? "rect", width: fr.width ?? 100, height: fr.height ?? 100,
    fill: g("data-shape-fill-color") ?? "#000000", stroke: g("data-shape-stroke-color"),
    strokeWidth: parseFloat(g("data-shape-stroke-width") ?? "0") || 0, radius: parseFloat(g("data-shape-corner-radius") ?? "0") || 0,
  };
}

/** Change a shape's settings and redraw it (icons, symbol-*, only change colour). */
export function setShape(b: Block, patch: Partial<ShapeSpec>): void {
  const s = { ...shapeSpec(b), ...patch };
  const set = (k: string, v: string | null) => setAttr(b.content, k, v);
  set("data-shape-type", s.type);
  set("data-shape-fill-color", s.fill);
  set("data-shape-stroke-color", s.stroke && s.strokeWidth > 0 ? s.stroke : null);
  set("data-shape-stroke-width", s.stroke && s.strokeWidth > 0 ? `${s.strokeWidth}px` : null);
  if (s.type === "rect") set("data-shape-corner-radius", s.radius ? `${s.radius}px` : null);
  if (s.type.startsWith("symbol-")) {
    setShapeFill(b, s.fill);
    return;
  }
  b.inner = shapeSvg(s, `od-clip-${b.id}`);
}

// --- image crop and opacity -----------------------------------------------------------------

export interface Crop { x: number; y: number; width: number; height: number } // fractions of the original image

function imgOf(b: Block): { tpl: HTMLTemplateElement; img: HTMLImageElement | null } {
  const tpl = document.createElement("template");
  tpl.innerHTML = b.inner;
  return { tpl, img: tpl.content.querySelector("img") };
}

export function imageCrop(b: Block): Crop {
  const { img } = imgOf(b);
  const n = (k: string, d: number) => { const v = img?.getAttribute(k); return v === null || v === undefined ? d : parseFloat(v); };
  return { x: n("data-crop-x", 0), y: n("data-crop-y", 0), width: n("data-crop-width", 1) || 1, height: n("data-crop-height", 1) || 1 };
}

const r4 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Write the crop attributes and the <img> size/offset that show that crop in the block's current frame. */
function applyCrop(b: Block, c: Crop): void {
  const { tpl, img } = imgOf(b);
  if (!img) return;
  const fr = frame(b);
  const bw = fr.width ?? 0, bh = fr.height ?? 0;
  const full = c.x === 0 && c.y === 0 && c.width >= 0.999999 && c.height >= 0.999999;
  if (full) {
    ["data-crop-x", "data-crop-y", "data-crop-width", "data-crop-height", "style"].forEach((k) => img.removeAttribute(k));
  } else {
    const w = bw / c.width, h = bh / c.height;
    img.setAttribute("data-crop-x", String(r4(c.x)));
    img.setAttribute("data-crop-y", String(r4(c.y)));
    img.setAttribute("data-crop-width", String(r4(c.width)));
    img.setAttribute("data-crop-height", String(r4(c.height)));
    img.setAttribute("style", `left: ${r3(-c.x * w)}px; top: ${r3(-c.y * h)}px; width: ${r3(w)}px; height: ${r3(h)}px;`);
  }
  b.inner = tpl.innerHTML;
}

/** Change the crop, keeping the picture's scale and position on the slide: the block grows or shrinks. */
export function setImageCrop(b: Block, next: Crop): void {
  const cur = imageCrop(b);
  const fr = frame(b);
  const bw = fr.width ?? 0, bh = fr.height ?? 0;
  const fullW = bw / cur.width, fullH = bh / cur.height; // displayed size of the whole image
  setStyle(b.outer, "left", fmt(fr.left + (next.x - cur.x) * fullW));
  setStyle(b.outer, "top", fmt(fr.top + (next.y - cur.y) * fullH));
  setStyle(b.outer, "width", fmt(Math.max(1, next.width * fullW)));
  setStyle(b.outer, "height", fmt(Math.max(1, next.height * fullH)));
  applyCrop(b, next);
}

/** Opacity in %, on the .sl-block-style wrapper (created if needed), as slides.com stores it. */
export function opacity(b: Block): number {
  const v = b.wrapper ? getStyle(b.wrapper, "opacity") : null;
  return v === null ? 100 : Math.round(parseFloat(v) * 100);
}

export function setOpacity(b: Block, percent: number): void {
  if (!b.wrapper) {
    const z = getStyle(b.content, "z-index");
    b.wrapper = { tag: "div", attrs: [["class", "sl-block-style"]] };
    if (z) setStyle(b.wrapper, "z-index", z);
  }
  const p = Math.max(0, Math.min(100, percent));
  setStyle(b.wrapper, "opacity", p >= 100 ? null : String(p / 100));
}
