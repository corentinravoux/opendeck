// A deck in the editor: icon rail, slide list, canvas, export dialog.
import { useEffect, useRef, useState } from "preact/hooks";
import { Canvas } from "../editor/Canvas";
import { handleKey } from "../editor/keys";
import { Layers } from "../editor/Layers";
import { Inspector } from "../editor/Inspector";
import { History } from "../editor/History";
import { Library } from "../editor/Library";
import { SlideHtml } from "../editor/SlideHtml";
import { imageFiles, insertImages } from "../editor/media";
import { onCopy, onPaste } from "../editor/clipboard";
import { addSlide, duplicateSlide, moveSlide, removeSlide } from "../model/ops";
import { mathBlock, shapeBlock, textBlock } from "../model/factory";
import type { Block, Slide } from "../model/types";
import { openEditor, type Editor } from "../editor/store";
import { slideHtml } from "../model/serialize";
import type { Deck } from "./api";
import { ExportDialog } from "./ExportDialog";
import { Icon } from "./icons";
import { renderSlide } from "./slide";

declare global {
  interface Window { opendeckFlush?: () => Promise<boolean> }
}

function SlideThumb({ html, deck, n, active, onClick }: {
  html: string; deck: Deck; n: number; active: boolean; onClick: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef(false);
  useEffect(() => {
    const el = ref.current!;
    if (seen.current) {
      renderSlide(el, html, deck.name, deck.meta, 176);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        seen.current = true;
        renderSlide(el, html, deck.name, deck.meta, 176);
        io.disconnect();
      }
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [html]);
  return (
    <button class={`od-slide-thumb${active ? " active" : ""}`} onClick={onClick} title={`Slide ${n}`}>
      <span class="od-slide-n">{n}</span>
      <div ref={ref} class="od-slide-box" style={{ height: `${(deck.meta.height * 176) / deck.meta.width}px` }} />
    </button>
  );
}

const SAVE_LABEL = { saved: "Saved", dirty: "Unsaved changes", saving: "Saving", conflict: "Changed elsewhere: reload the deck", error: "Not saved" };

export function DeckView({ name }: { name: string }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [layers, setLayers] = useState(false);
  const [history, setHistory] = useState(false);
  const [library, setLibrary] = useState(false);
  const [htmlOpen, setHtmlOpen] = useState(false);
  const [reloads, setReloads] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEditor(null); // never show (or paste into) the previous deck while this one loads
    openEditor(name).then((ed) => {
      setEditor(ed);
      document.title = `${ed.deck.meta.title} — opendeck`;
      window.opendeckFlush = async () => { await ed.save(); return ed.saveState.value === "saved"; };
    }).catch((e) => setError(String(e.message ?? e)));
    return () => { window.opendeckFlush = undefined; };
  }, [name, reloads]);

  useEffect(() => {
    if (!editor) return;
    const onKey = (e: KeyboardEvent) => {
      if (exporting || library || htmlOpen) return;
      if (e.altKey && e.shiftKey && e.code === "KeyH") { editor.flushText?.(); setHtmlOpen(true); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") { setLayers((v) => !v); e.preventDefault(); return; }
      if (!editor.selection.value.length && !(e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) {
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && e.key.toLowerCase() === "d") { slideOp("dup"); e.preventDefault(); return; }
        if (ctrl && (e.key === "Backspace" || e.key === "Delete")) { slideOp("del"); e.preventDefault(); return; }
      }
      if (handleKey(editor, e, editor.doc.value.slides.length)) e.preventDefault();
    };
    const onHide = () => void editor.save();
    const typing = (e: Event) => !!(e.target as HTMLElement).closest?.("input, textarea, [contenteditable=true]");
    const pasteHandler = (e: ClipboardEvent) => {
      if (typing(e)) return;
      e.preventDefault();
      const data = e.clipboardData;
      void onPaste(editor, data).then((done) => {
        if (done) return;
        const files = imageFiles(data);
        if (files.length) void insertImages(editor, files, editor.deck.meta.width / 2, editor.deck.meta.height / 2);
      });
    };
    const copyHandler = (cut: boolean) => (e: ClipboardEvent) => {
      if (typing(e)) return;
      if (onCopy(editor, e, cut)) e.preventDefault();
    };
    const onCopyEv = copyHandler(false), onCutEv = copyHandler(true);
    addEventListener("paste", pasteHandler);
    document.body.dataset.odEditor = editor.name; // listeners attached: the editor is ready
    addEventListener("copy", onCopyEv);
    addEventListener("cut", onCutEv);
    addEventListener("keydown", onKey);
    addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("pagehide", onHide);
      delete document.body.dataset.odEditor;
      removeEventListener("paste", pasteHandler);
      removeEventListener("copy", onCopyEv);
      removeEventListener("cut", onCutEv);
      document.removeEventListener("visibilitychange", onHide);
      void editor.save();
    };
  }, [editor, exporting, library, htmlOpen]);

  const current = editor?.current.value ?? 0;
  useEffect(() => {
    listRef.current?.querySelector(".od-slide-thumb.active")?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const insert = (make: (s: Slide) => Block) => {
    if (!editor) return;
    let id = "";
    editor.edit("Insert", (doc) => {
      const s = doc.slides[editor.current.value];
      const b = make(s);
      s.items.push({ kind: "block", block: b });
      s.dirty = true;
      id = b.id;
    });
    editor.selection.value = [id];
  };
  const slideOp = (op: "add" | "dup" | "del") => {
    if (!editor) return;
    editor.flushText?.();
    const cur = editor.current.value;
    let next = cur;
    editor.edit(op === "add" ? "New slide" : op === "dup" ? "Duplicate slide" : "Delete slide", (doc) => {
      if (op === "add") next = addSlide(doc, cur);
      else if (op === "dup") next = duplicateSlide(doc, cur);
      else { removeSlide(doc, cur); next = Math.min(cur, doc.slides.length - 1); }
    });
    editor.current.value = next;
    editor.selection.value = [];
  };
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const dropSlide = (to: number) => {
    if (!editor || dragFrom === null || dragFrom === to) return;
    const from = dragFrom;
    editor.edit("Move slide", (doc) => moveSlide(doc, from, to));
    editor.current.value = to;
    setDragFrom(null);
  };

  const pickImages = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = () => editor && void insertImages(editor, [...(input.files ?? [])], editor.deck.meta.width / 2, editor.deck.meta.height / 2);
    input.click();
  };

  if (error) return <p class="od-error od-muted">This deck did not open: {error}. <a href="#/">Back to all decks</a></p>;
  if (!editor) return <p class="od-muted">Opening the deck…</p>;
  const slides = editor.doc.value.slides;
  const state = editor.saveState.value;

  return (
    <div class="od-editor">
      <nav class="od-rail" aria-label="Tools">
        <a class="od-rail-btn" href="#/" data-tip="All decks" aria-label="All decks"><Icon name="home" /></a>
        <button class="od-rail-btn" data-tip="Undo (Ctrl+Z)" aria-label="Undo" onClick={() => editor.undo()}><Icon name="undo" /></button>
        <button class="od-rail-btn" data-tip="Redo (Ctrl+Y)" aria-label="Redo" onClick={() => editor.redo()}><Icon name="redo" /></button>
        <span class="od-rail-sep" />
        <button class="od-rail-btn" data-tip="Text (T)" aria-label="Add text"
          onClick={() => { insert((s) => textBlock(s, 212, 250)); editor.pendingEdit.value = editor.selection.value[0]; }}><Icon name="text" /></button>
        <button class="od-rail-btn" data-tip="Maths" aria-label="Add maths" onClick={() => insert((s) => mathBlock(s, 412, 240))}><Icon name="sigma" /></button>
        <button class="od-rail-btn" data-tip="Image: or drop / paste one on the slide" aria-label="Add image" onClick={pickImages}><Icon name="image" /></button>
        <button class="od-rail-btn" data-tip="Images from your decks" aria-label="Image library" onClick={() => setLibrary(true)}><Icon name="library" /></button>
        <button class="od-rail-btn" data-tip="Shape" aria-label="Add shape" onClick={() => insert((s) => shapeBlock(s, 412, 228))}><Icon name="shape" /></button>
        <button class={`od-rail-btn${editor.tool.value === "line" ? " on" : ""}`} data-tip="Line (L): drag on the slide" aria-label="Draw a line"
          aria-pressed={editor.tool.value === "line"} onClick={() => (editor.tool.value = editor.tool.value === "line" ? null : "line")}><Icon name="line" /></button>
        <button class={`od-rail-btn${editor.tool.value === "arrow" ? " on" : ""}`} data-tip="Arrow (A): drag on the slide" aria-label="Draw an arrow"
          aria-pressed={editor.tool.value === "arrow"} onClick={() => (editor.tool.value = editor.tool.value === "arrow" ? null : "arrow")}><Icon name="arrow" /></button>
        <button class={`od-rail-btn${editor.tool.value === "pen" ? " on" : ""}`} data-tip="Pen (P): draw freehand, Esc to stop" aria-label="Draw freehand"
          aria-pressed={editor.tool.value === "pen"} onClick={() => (editor.tool.value = editor.tool.value === "pen" ? null : "pen")}><Icon name="pen" /></button>
        <span class="od-rail-sep" />
        <button class={`od-rail-btn${history ? " on" : ""}`} data-tip="History: earlier versions" aria-label="History"
          aria-pressed={history} onClick={() => setHistory((v) => !v)}><Icon name="history" /></button>
        <button class={`od-rail-btn${layers ? " on" : ""}`} data-tip="Layers (Ctrl+O)" aria-label="Layers" aria-pressed={layers}
          onClick={() => setLayers((v) => !v)}><Icon name="layers" /></button>
        <span class="od-rail-fill" />
        <a class="od-rail-btn" href={`/view/${encodeURIComponent(name)}/#/${current}`} target="_blank" data-tip="Preview" aria-label="Preview"><Icon name="play" /></a>
        <button class="od-rail-btn" data-tip="Export as PDF or HTML" aria-label="Export"
          onClick={async () => { await editor.save(); setExporting(true); }}><Icon name="export" /></button>
        <button class={`od-rail-btn od-save-${state}`} data-tip={`${SAVE_LABEL[state]}: Ctrl+S saves and records a version`}
          aria-label={SAVE_LABEL[state]} onClick={() => void editor.save(true)}><Icon name={state === "saved" ? "check" : "dot"} /></button>
      </nav>
      <aside class="od-slides" ref={listRef} aria-label="Slides">
        <div class="od-deck-head">
          <button class="od-deck-title" title={`${name}: click to rename`} onClick={async () => {
            const t = prompt("Deck title", editor.deck.meta.title);
            if (t && t.trim() && t !== editor.deck.meta.title) { await editor.setMeta({ title: t.trim() }); setReloads((n) => n + 1); }
          }}>{editor.deck.meta.title}</button>
          <button class="od-icon-btn" title="Move this deck to the trash" aria-label="Move this deck to the trash" onClick={async () => {
            if (!confirm(`Move “${editor.deck.meta.title}” to the trash? It goes to the .trash folder of your decks and can be moved back by hand.`)) return;
            await editor.save(true);
            const r = await fetch(`/api/decks/${encodeURIComponent(name)}`, { method: "DELETE", headers: { "X-Opendeck": "1" } });
            if (r.ok) location.hash = "#/"; else alert(`The deck was not moved: ${(await r.json()).error}`);
          }}><Icon name="trash" size={16} /></button>
        </div>
        <div class="od-slide-tools">
          <button title="New slide" aria-label="New slide" onClick={() => slideOp("add")}><Icon name="plus" size={18} /></button>
          <button title="Duplicate slide (Ctrl+D)" aria-label="Duplicate slide" onClick={() => slideOp("dup")}><Icon name="copy" size={18} /></button>
          <button title="Delete slide (Ctrl+Backspace)" aria-label="Delete slide" disabled={slides.length < 2} onClick={() => slideOp("del")}><Icon name="trash" size={18} /></button>
        </div>
        {slides.map((s, i) => (
          <div key={s.id || i} draggable onDragStart={() => setDragFrom(i)} onDragOver={(e) => dragFrom !== null && e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); dropSlide(i); }}>
            <SlideThumb html={slideHtml(s)} deck={editor.deck} n={i + 1} active={i === current}
              onClick={() => { editor.flushText?.(); editor.current.value = i; editor.selection.value = []; }} />
          </div>
        ))}
      </aside>
      <div class="od-center">
        {slides.length > 0 && <Canvas editor={editor} />}
        <div class="od-status" role="status">
          {(state === "conflict" || state === "error") && <span class="od-error">{editor.message.value}</span>}
          {editor.zoom.value !== 1 && <button class="od-zoom" title="Fit to the window (0)" onClick={() => (editor.zoom.value = 1)}>{Math.round(editor.zoom.value * 100)} %</button>}
          <span>Slide {current + 1} of {slides.length}</span>
        </div>
      </div>
      <div class="od-side">
        <Inspector editor={editor} />
        {layers && <Layers editor={editor} />}
        {history && <History editor={editor} onRestored={() => { setHistory(false); setReloads((n) => n + 1); }} />}
      </div>
      {htmlOpen && <SlideHtml editor={editor} onClose={() => setHtmlOpen(false)} />}
      {library && <Library editor={editor} onClose={() => setLibrary(false)} />}
      {exporting && <ExportDialog deck={editor.deck} onClose={() => setExporting(false)} />}
    </div>
  );
}
