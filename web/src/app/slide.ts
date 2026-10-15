// Renders one slide of a deck into a container with the shared renderer (same CSS and
// hydration as the exported deck, so what you see is what you export).
import { hydrateSection, type DeckMeta as RuntimeMeta } from "../render/hydrate";
import type { DeckMeta } from "./api";
import { viewUrl } from "./api";

/** Split a deck's slides HTML into one string per top-level <section>. */
export function splitSections(html: string): string[] {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  return [...tpl.content.children].filter((el) => el.tagName === "SECTION").map((el) => el.outerHTML);
}

/** Point relative media URLs at the deck folder (display only; never saved). */
export function absolutiseMedia(html: string, deck: string): string {
  const base = viewUrl(deck);
  return html.replace(/(\s(?:src|poster|data-print|data-background-image)=")(media\/)/g, `$1${base}$2`);
}

/** Videos in the editor and thumbnails show their poster (or first frame) and do not buffer the clip. */
export function stillVideos(html: string): string {
  return html.replace(/(<video\b[^>]*?\spreload=")[^"]*"/g, '$1metadata"');
}

/**
 * Fill `host` with a scaled, hydrated copy of one slide.
 * `width` is the on-screen width in px; the slide keeps its own size and is scaled.
 */
export function renderSlide(host: HTMLElement, sectionHtml: string, deck: string, meta: DeckMeta, width: number): void {
  const scale = width / meta.width;
  host.innerHTML = "";
  host.style.width = `${width}px`;
  host.style.height = `${meta.height * scale}px`;
  const theme = document.createElement("div");
  theme.className = `od-stage theme-font-${meta.theme_font} theme-color-${meta.theme_color}`;
  const reveal = document.createElement("div");
  reveal.className = "reveal";
  reveal.style.width = `${meta.width}px`;
  reveal.style.height = `${meta.height}px`;
  reveal.style.transform = `scale(${scale})`;
  reveal.style.transformOrigin = "0 0";
  const slides = document.createElement("div");
  slides.className = "slides";
  slides.style.setProperty("--od-w", `${meta.width}px`);
  slides.style.setProperty("--od-h", `${meta.height}px`);
  slides.innerHTML = stillVideos(absolutiseMedia(sectionHtml, deck));
  const section = slides.querySelector<HTMLElement>(":scope > section");
  if (section) {
    section.classList.add("od-current");
    hydrateSection(section, { ...meta, macros: meta.macros ?? {} } as RuntimeMeta);
  }
  reveal.appendChild(slides);
  theme.appendChild(reveal);
  host.appendChild(theme);
}
