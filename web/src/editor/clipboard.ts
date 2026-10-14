// Copy and paste of blocks and slides, within a deck and between decks. The clipboard carries
// the blocks' HTML plus the source deck's name; pasting into another deck first copies the
// images they use into that deck's media/ folder.
import { blocksOf, cloneWithNewIds, findBlock, insertSlides, moveBlock, removeBlocks, setZIndex, zIndex } from "../model/ops";
import { parseBlock, parseSection } from "../model/parse";
import { blockHtml, slideHtml } from "../model/serialize";
import type { Editor } from "./store";

const MARK = "data-opendeck-clip";

interface Clip { deck: string; kind: "blocks" | "slides"; html: string[] }

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export function mediaRefs(html: string[]): string[] {
  return [...new Set(html.flatMap((h) => h.match(/(?<=["'(])media\/[A-Za-z0-9_.-]+(?=["')])/g) ?? []))];
}

function readClip(data: DataTransfer | null): Clip | null {
  const html = data?.getData("text/html") ?? "";
  if (!html.includes(MARK)) return null;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const raw = tpl.content.querySelector(`[${MARK}]`)?.getAttribute(MARK);
  try { return raw ? (JSON.parse(raw) as Clip) : null; } catch { return null; }
}

export function onCopy(editor: Editor, e: ClipboardEvent, cut: boolean): boolean {
  const slide = editor.slide;
  if (!slide || !e.clipboardData) return false;
  const sel = editor.selection.value;
  const clip: Clip = sel.length
    ? { deck: editor.name, kind: "blocks", html: blocksOf(slide.items).filter((b) => sel.includes(b.id)).map(blockHtml) }
    : { deck: editor.name, kind: "slides", html: [slideHtml(slide)] };
  e.clipboardData.setData("text/html", `<div ${MARK}="${escAttr(JSON.stringify(clip))}"></div>`);
  e.clipboardData.setData("text/plain", clip.kind === "blocks" ? `${clip.html.length} opendeck block(s)` : "opendeck slide");
  if (cut && sel.length) {
    editor.edit("Cut", (doc) => removeBlocks(doc.slides[editor.current.value], sel));
    editor.selection.value = [];
  }
  return true;
}

/** Paste opendeck content; false if the clipboard holds none (let other handlers try). */
export async function onPaste(editor: Editor, data: DataTransfer | null): Promise<boolean> {
  const clip = readClip(data);
  if (!clip) return false;
  if (clip.deck !== editor.name) {
    const refs = mediaRefs(clip.html);
    if (refs.length) {
      const r = await fetch(`/api/decks/${encodeURIComponent(editor.name)}/media/copy`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Opendeck": "1" },
        body: JSON.stringify({ from: clip.deck, srcs: refs }),
      });
      if (!r.ok) { editor.message.value = (await r.json()).error ?? "could not copy images"; return true; }
    }
  }
  if (clip.kind === "slides") {
    const sources = clip.html.map((h) => parseSection(h));
    let at = 0;
    editor.edit("Paste slides", (doc) => { at = insertSlides(doc, editor.current.value, sources); });
    editor.current.value = at;
    editor.selection.value = [];
    return true;
  }
  const tpl = document.createElement("template");
  const made: string[] = [];
  editor.edit("Paste", (doc) => {
    const s = doc.slides[editor.current.value];
    let z = Math.max(9, ...blocksOf(s.items).map(zIndex));
    for (const html of clip.html) {
      tpl.innerHTML = html;
      const el = tpl.content.querySelector(".sl-block");
      if (!el) continue;
      const b = cloneWithNewIds(parseBlock(el));
      const sameSpot = clip.deck === editor.name && findBlock(s, parseBlock(el).id);
      if (sameSpot) moveBlock(b, 20, 20);
      setZIndex(b, ++z);
      s.items.push({ kind: "block", block: b });
      made.push(b.id);
    }
    s.dirty = true;
  });
  editor.selection.value = made;
  return true;
}
