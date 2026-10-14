// lib/opendeck.js: shows a deck offline. Modes:
//   (default)          one slide, scaled to fit; arrows / space / PgUp / PgDn / Home / End; #/n (0-based)
//   ?print-pdf         every slide as one page of the deck's size (used by the PDF export)
//   ?slide=n&static    slide n (0-based) at scale 1, no controls (thumbnails, tests)
// html[data-od-ready] is set once fonts, images and maths are done.
import "katex/dist/katex.min.css";
import "./fonts.css";
import "../render/base.css";
import "../render/theme/presets.css";
import { hydrateSection, readMeta, type DeckMeta } from "../render/hydrate";

function slideNumber(n: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "od-slide-number";
  el.textContent = String(n);
  return el;
}

async function ready(sections: HTMLElement[]): Promise<void> {
  const images = sections.flatMap((s) => [...s.querySelectorAll("img")]);
  await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
  await document.fonts.ready;
  document.documentElement.dataset.odReady = "1";
}

function printMode(meta: DeckMeta, sections: HTMLElement[]): void {
  document.documentElement.classList.add("od-print");
  const page = document.createElement("style");
  page.textContent = `@page { size: ${meta.width}px ${meta.height}px; margin: 0; }`;
  document.head.appendChild(page);
  let n = 0;
  for (const s of sections) {
    if (s.dataset.visibility === "hidden") continue;
    n += 1;
    if (meta.slide_number) s.appendChild(slideNumber(n));
  }
}

function viewMode(meta: DeckMeta, sections: HTMLElement[], fixed: number | null): void {
  const html = document.documentElement;
  html.classList.add(fixed === null ? "od-view" : "od-static");
  const reveal = document.querySelector<HTMLElement>(".reveal")!;
  const slides = document.querySelector<HTMLElement>(".reveal .slides")!;
  const badge = slideNumber(1);
  if (meta.slide_number && fixed === null) reveal.appendChild(badge);
  let current = 0;

  const fit = () => {
    if (fixed !== null) {
      reveal.style.width = `${meta.width}px`;
      reveal.style.height = `${meta.height}px`;
      return;
    }
    const scale = Math.min(innerWidth / meta.width, innerHeight / meta.height);
    slides.style.transform = `translate(${(innerWidth - meta.width * scale) / 2}px, ${(innerHeight - meta.height * scale) / 2}px) scale(${scale})`;
  };
  const show = (i: number) => {
    current = Math.max(0, Math.min(sections.length - 1, i));
    sections.forEach((s, k) => s.classList.toggle("od-current", k === current));
    badge.textContent = String(current + 1);
    if (fixed === null && location.hash !== `#/${current}`) history.replaceState(null, "", `#/${current}`);
  };
  const fromHash = () => Number(/^#\/(\d+)/.exec(location.hash)?.[1] ?? 0);

  fit();
  show(fixed ?? fromHash());
  if (fixed !== null) return;
  addEventListener("resize", fit);
  addEventListener("hashchange", () => show(fromHash()));
  addEventListener("keydown", (e) => {
    const step: Record<string, number> = {
      ArrowRight: 1, ArrowDown: 1, PageDown: 1, " ": 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1,
    };
    if (e.key in step) show(current + step[e.key]);
    else if (e.key === "Home") show(0);
    else if (e.key === "End") show(sections.length - 1);
    else if (e.key === "f") document.documentElement.requestFullscreen?.();
    else return;
    e.preventDefault();
  });
}

function main(): void {
  const meta = readMeta();
  const slides = document.querySelector<HTMLElement>(".reveal .slides");
  if (!slides) return;
  slides.style.setProperty("--od-w", `${meta.width}px`);
  slides.style.setProperty("--od-h", `${meta.height}px`);
  const sections = [...slides.querySelectorAll<HTMLElement>(":scope > section")];
  sections.forEach((s) => hydrateSection(s, meta));
  const params = new URLSearchParams(location.search);
  if (params.has("print-pdf")) printMode(meta, sections);
  else viewMode(meta, sections, params.has("static") ? Number(params.get("slide") ?? 0) : null);
  void ready(sections);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
else main();
