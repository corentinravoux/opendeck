// In-place text editing: the rendered block content becomes contenteditable, so what you type
// has the deck's exact styling. Inline maths shows as raw TeX while editing (as in slides.com)
// and is typeset again on leaving. A block left unchanged keeps its HTML byte for byte.
import { useEffect, useRef, useState } from "preact/hooks";
import { findBlock } from "../model/ops";
import { Icon, type IconName } from "../app/icons";
import { FONTS } from "./fonts";
import { Palette } from "./Palette";
import type { Editor } from "./store";

/** Tidy what the browser's editing commands produce, closer to the decks' own markup. */
export function normaliseEditedHtml(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const swap = (from: string, to: string) => {
    for (const el of [...tpl.content.querySelectorAll(from)]) {
      const n = document.createElement(to);
      for (const a of el.attributes) n.setAttribute(a.name, a.value);
      n.append(...el.childNodes);
      el.replaceWith(n);
    }
  };
  swap("b", "strong");
  swap("i", "em");
  // <font size="7"> is the marker left by setSize(); anything else from <font> becomes a span
  for (const f of [...tpl.content.querySelectorAll("font")]) {
    const span = document.createElement("span");
    if (f.getAttribute("color")) span.style.color = f.getAttribute("color")!;
    if (f.getAttribute("face") && f.getAttribute("face") !== "od-font-marker") span.style.fontFamily = f.getAttribute("face")!;
    span.append(...f.childNodes);
    f.replaceWith(span);
  }
  // a block must hold at least one paragraph
  if (!tpl.content.firstElementChild && tpl.content.textContent?.trim()) {
    const p = document.createElement("p");
    p.append(...tpl.content.childNodes);
    tpl.content.append(p);
  }
  return tpl.innerHTML;
}

const exec = (cmd: string, value?: string) => document.execCommand(cmd, false, value);

/** Swap the <font> markers left by an editing command for styled spans, keeping the text selected. */
function replaceMarkers(selector: string, style: (span: HTMLElement) => void) {
  const sel = window.getSelection();
  const root = sel?.anchorNode instanceof Element ? sel.anchorNode.closest(".sl-block-content")
    : sel?.anchorNode?.parentElement?.closest(".sl-block-content");
  const spans: HTMLElement[] = [];
  for (const f of [...(root?.querySelectorAll(selector) ?? [])]) {
    const span = document.createElement("span");
    style(span);
    span.append(...f.childNodes);
    f.replaceWith(span);
    spans.push(span);
  }
  if (spans.length && sel) {
    const range = document.createRange();
    range.setStartBefore(spans[0]);
    range.setEndAfter(spans[spans.length - 1]);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

/** Wrap the selection in a span with a font size in em (the unit the decks use). */
function setSize(em: string) {
  exec("styleWithCSS", "false");
  exec("fontSize", "7");
  replaceMarkers('font[size="7"]', (span) => (span.style.fontSize = em));
}

const SIZES = ["0.5em", "0.6em", "0.7em", "0.8em", "0.9em", "1em", "1.2em", "1.4em", "1.6em", "2em", "2.5em", "3em"];

/** Apply a font family to the selection as <span style="font-family: …">. */
function setFont(css: string) {
  exec("styleWithCSS", "false");
  exec("fontName", "od-font-marker");
  replaceMarkers('font[face="od-font-marker"]', (span) => (span.style.fontFamily = css));
}

function setColour(colour: string) {
  exec("styleWithCSS", "true");
  exec("foreColor", colour);
}

type Btn = [IconName, string, () => void];

const STYLE: Btn[] = [
  ["bold", "Bold (Ctrl+B)", () => exec("bold")],
  ["italic", "Italic (Ctrl+I)", () => exec("italic")],
  ["underline", "Underline (Ctrl+U)", () => exec("underline")],
  ["strike", "Strikethrough", () => exec("strikeThrough")],
  ["subscript", "Subscript", () => exec("subscript")],
  ["superscript", "Superscript", () => exec("superscript")],
];
const PARA: Btn[] = [
  ["bullets", "Bullet list", () => exec("insertUnorderedList")],
  ["numbers", "Numbered list", () => exec("insertOrderedList")],
  ["alignLeft", "Align left", () => exec("justifyLeft")],
  ["alignCenter", "Centre", () => exec("justifyCenter")],
  ["alignRight", "Align right", () => exec("justifyRight")],
];

export function TextToolbar({ x, y, deckColours }: { x: number; y: number; deckColours: string[] }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [last, setLast] = useState("#000000");
  const saved = useRef<Range | null>(null);
  const keep = (e: Event) => { if ((e.target as HTMLElement).tagName !== "SELECT" && (e.target as HTMLElement).tagName !== "INPUT") e.preventDefault(); };
  const btn = ([icon, title, run]: Btn) => (
    <button class="od-tb-btn" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      <Icon name={icon} size={16} />
    </button>
  );
  const openPalette = () => {
    const sel = window.getSelection();
    saved.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    setPaletteOpen((v) => !v);
  };
  const pick = (c: string) => {
    // the custom colour fields take the focus: put the text selection back first
    const sel = window.getSelection();
    if (saved.current && sel) {
      (saved.current.startContainer.parentElement?.closest("[contenteditable=true]") as HTMLElement | null)?.focus();
      sel.removeAllRanges();
      sel.addRange(saved.current);
    }
    setColour(c);
    setLast(c);
    setPaletteOpen(false);
  };
  return (
    <div class="od-texttools" style={{ left: `${x}px`, top: `${y}px` }} onMouseDown={keep} role="toolbar" aria-label="Text formatting">
      <span class="od-tb-select">
        <select title="Font" aria-label="Font" value="" onChange={(e) => { setFont((e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ""; }}>
          <option value="" disabled>Font</option>
          {FONTS.map((f) => <option value={f.css} style={{ fontFamily: f.css }}>{f.label}</option>)}
        </select>
        <Icon name="down" size={12} />
      </span>
      <span class="od-tb-select">
        <select title="Size" aria-label="Size" value="" onChange={(e) => { setSize((e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ""; }}>
          <option value="" disabled>Size</option>
          {SIZES.map((s) => <option value={s}>{s}</option>)}
        </select>
        <Icon name="down" size={12} />
      </span>
      <span class="od-tb-colour">
        <button class="od-swatch-btn" title="Text colour" aria-label="Text colour" aria-expanded={paletteOpen}
          onMouseDown={(e) => e.preventDefault()} onClick={openPalette}><span class="od-chip" style={{ background: last }} /></button>
        {paletteOpen && <Palette deck={deckColours} value={last} onPick={pick} keepFocus />}
      </span>
      <span class="od-tb-sep" />
      {STYLE.map(btn)}
      <span class="od-tb-sep" />
      {PARA.map(btn)}
      <span class="od-tb-sep" />
      {btn(["link", "Add a link", () => { const url = prompt("Link address"); if (url) exec("createLink", url); }])}
      {btn(["eraser", "Remove formatting", () => exec("removeFormat")])}
    </div>
  );
}

/** Start editing block `id` in the rendered `content` element; returns a function that ends it. */
export function useTextEditing(editor: Editor) {
  const [editing, setEditing] = useState<string | null>(null);
  const original = useRef("");

  const commit = (content: HTMLElement | null) => {
    if (!editing) return;
    const id = editing;
    setEditing(null);
    if (!content) return;
    content.contentEditable = "false";
    const html = content.innerHTML;
    if (html === original.current) return; // untouched: keep the saved bytes
    const next = normaliseEditedHtml(html);
    editor.edit("Edit text", (doc) => {
      const s = doc.slides[editor.current.value];
      const b = findBlock(s, id);
      if (b) { b.inner = next; s.dirty = true; }
    });
  };

  const start = (id: string, content: HTMLElement, selectAll = false) => {
    const block = findBlock(editor.slide, id);
    if (!block || block.type !== "text") return;
    content.innerHTML = block.inner; // raw source, inline TeX included
    original.current = content.innerHTML;
    content.contentEditable = "true";
    content.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(content);
      if (!selectAll) range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    setEditing(id);
  };

  useEffect(() => () => setEditing(null), [editor.current.value]);
  return { editing, start, commit };
}
