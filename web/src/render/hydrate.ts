// The one rendering step shared by the viewer, the PDF print mode and (later) the editor canvas.
// It only adds live DOM (typeset maths, backgrounds); the saved HTML is never read back from it.
import { renderInlineMath, renderMathBlock } from "./math";

export interface DeckMeta {
  title: string;
  width: number;
  height: number;
  slide_number: boolean;
  macros: Record<string, string>;
  theme_font: string;
  theme_color: string;
}

export function readMeta(doc: Document = document): DeckMeta {
  const el = doc.getElementById("opendeck-meta");
  return JSON.parse(el?.textContent ?? "{}") as DeckMeta;
}

export function hydrateSection(section: HTMLElement, meta: DeckMeta): void {
  const macros = meta.macros ?? {};
  for (const c of section.querySelectorAll<HTMLElement>('.sl-block[data-block-type="math"] .sl-block-content')) {
    renderMathBlock(c, macros);
  }
  for (const c of section.querySelectorAll<HTMLElement>('.sl-block[data-block-type="text"] .sl-block-content')) {
    renderInlineMath(c, macros);
  }
  const bg = section.dataset.backgroundColor;
  if (bg) section.style.backgroundColor = bg;
  const image = section.dataset.backgroundImage;
  if (image) {
    section.style.backgroundImage = `url("${image}")`;
    section.style.backgroundSize = section.dataset.backgroundSize ?? "cover";
    section.style.backgroundPosition = section.dataset.backgroundPosition ?? "center";
    section.style.backgroundRepeat = "no-repeat";
  }
}
