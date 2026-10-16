// New blocks, in the HTML shape slides.com uses (so decks stay one format).
import { blocksOf, newId, setLine, setShape, zIndex } from "./ops";
import type { Block, Slide } from "./types";

const nextZ = (slide: Slide) => Math.max(9, ...blocksOf(slide.items).map(zIndex)) + 1;

function base(type: string, slide: Slide, frame: string, contentAttrs: [string, string][], inner: string): Block {
  const id = newId();
  const z = nextZ(slide);
  return {
    id,
    type,
    outer: { tag: "div", attrs: [["class", "sl-block"], ["data-block-type", type], ["style", frame], ["data-block-id", id]] },
    wrapper: null,
    content: { tag: "div", attrs: [["class", "sl-block-content"], ...contentAttrs, ["style", `z-index: ${z};`]] },
    inner,
    children: null,
    extras: "",
  };
}

const r = (n: number) => Math.round(n * 1000) / 1000;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function imageBlock(slide: Slide, src: string, left: number, top: number, width: number, height: number,
  natural?: { width: number | null; height: number | null }): Block {
  const nat = natural?.width && natural?.height
    ? ` data-natural-width="${natural.width}" data-natural-height="${natural.height}"` : "";
  return base("image", slide, `width: ${r(width)}px; height: ${r(height)}px; left: ${r(left)}px; top: ${r(top)}px;`, [],
    `<img src="${esc(src)}"${nat}>`);
}

export interface VideoOptions {
  /** image shown before playback (and in the editor) */
  poster?: string | null;
  /** image shown in the PDF / print (the clip's last frame); the poster otherwise */
  print?: string | null;
  loop?: boolean;
  /** play from the start when the slide is entered (default true) */
  autoplay?: boolean;
}

/** A video block: muted (so it may autoplay), inline, preloaded; see render/video.ts. */
export function videoBlock(slide: Slide, src: string, left: number, top: number, width: number, height: number,
  opts: VideoOptions = {}): Block {
  const attrs = [`src="${esc(src)}"`];
  if (opts.poster) attrs.push(`poster="${esc(opts.poster)}"`);
  if (opts.print) attrs.push(`data-print="${esc(opts.print)}"`);
  attrs.push("muted", "playsinline", 'preload="auto"');
  if (opts.loop) attrs.push("loop");
  if (opts.autoplay === false) attrs.push('data-autoplay="false"');
  return base("video", slide, `width: ${r(width)}px; height: ${r(height)}px; left: ${r(left)}px; top: ${r(top)}px;`, [],
    `<video ${attrs.join(" ")}></video>`);
}

export function textBlock(slide: Slide, left: number, top: number, width = 600, html = "<p>Text</p>"): Block {
  return base("text", slide, `height: auto; width: ${r(width)}px; left: ${r(left)}px; top: ${r(top)}px;`,
    [["data-placeholder-tag", "p"], ["data-placeholder-text", "Text"]], html);
}

export function mathBlock(slide: Slide, left: number, top: number, tex = "E = mc^2"): Block {
  const b = base("math", slide, `width: auto; height: auto; left: ${r(left)}px; top: ${r(top)}px;`,
    [["data-math-display", "true"]], `<div class="math-input">${esc(tex)}</div>`);
  b.content.attrs[0] = ["class", "sl-block-content notranslate"];
  return b;
}

export function shapeBlock(slide: Slide, left: number, top: number, width = 200, height = 120, fill = "#3c78d8", type = "rect"): Block {
  const b = base("shape", slide, `width: ${r(width)}px; height: ${r(height)}px; left: ${r(left)}px; top: ${r(top)}px;`,
    [["data-shape-type", type], ["data-shape-fill-color", fill], ["data-shape-stretch", "true"]], "");
  setShape(b, {});
  return b;
}

export function lineBlock(slide: Slide, p1: [number, number], p2: [number, number], arrow: boolean, color = "#000000"): Block {
  const b = base("line", slide, "width: auto; height: auto; min-width: 0px; min-height: 0px; left: 0px; top: 0px;",
    [["data-line-x1", "0"], ["data-line-y1", "0"], ["data-line-x2", "0"], ["data-line-y2", "0"], ["data-line-color", color],
     ["data-line-width", "2px"], ["data-line-start-type", "none"], ["data-line-end-type", arrow ? "line-arrow" : "none"],
     ["data-line-style", "solid-rounded"]], "");
  setLine(b, p1, p2);
  return b;
}

export function drawingBlock(slide: Slide, d: { left: number; top: number; width: number; height: number; svg: string; points: string }): Block {
  return base("drawing", slide, `width: ${r(d.width)}px; height: ${r(d.height)}px; left: ${r(d.left)}px; top: ${r(d.top)}px;`,
    [["data-points", d.points], ["data-timestamp", String(Date.now())]], d.svg);
}
