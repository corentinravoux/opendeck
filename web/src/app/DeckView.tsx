// A deck in the editor, laid out like slides.com: icon rail and block palette on the left, the
// canvas, the side panel (block settings, layers, history) and the strip of slides below.
import { useEffect, useRef, useState } from "preact/hooks";
import { Canvas } from "../editor/Canvas";
import { handleKey } from "../editor/keys";
import { Layers } from "../editor/Layers";
import { Inspector } from "../editor/Inspector";
import { History } from "../editor/History";
import { Library } from "../editor/Library";
import { SlideHtml } from "../editor/SlideHtml";
import { insertMedia, mediaFiles } from "../editor/media";
import { onCopy, onPaste } from "../editor/clipboard";
import { addSlide, duplicateSlide, moveSlide, removeSlide } from "../model/ops";
import { mathBlock, shapeBlock, textBlock } from "../model/factory";
import type { Block, Slide } from "../model/types";
import { openEditor, type Editor, type SaveState } from "../editor/store";
import { snapGuides, toggleSnapGuides } from "../editor/prefs";
import { slideHtml } from "../model/serialize";
import { api, type Deck } from "./api";
import { ExportDialog } from "./ExportDialog";
import { Icon, type IconName } from "./icons";
import { renderSlide } from "./slide";
import { IconButton, Menu, ThemeToggle } from "./ui";

declare global {
  interface Window { opendeckFlush?: () => Promise<boolean> }
}

const THUMB = 112;

function SlideThumb({ html, deck, n, active, onClick }: {
  html: string; deck: Deck; n: number; active: boolean; onClick: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef(false);
  useEffect(() => {
    const el = ref.current!;
    if (seen.current) {
      renderSlide(el, html, deck.name, deck.meta, THUMB);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        seen.current = true;
        renderSlide(el, html, deck.name, deck.meta, THUMB);
        io.disconnect();
      }
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [html]);
  return (
    <button class={`od-slide-thumb${active ? " active" : ""}`} onClick={onClick} aria-label={`Slide ${n}`} aria-current={active}>
      <span class="od-slide-n">{n}</span>
      <div ref={ref} class="od-slide-box" style={{ height: `${(deck.meta.height * THUMB) / deck.meta.width}px` }} />
    </button>
  );
}

const SAVE_LABEL: Record<SaveState, string> = { saved: "Saved", dirty: "Edited", saving: "Saving", conflict: "Changed elsewhere", error: "Not saved" };

/** The deck title in the top bar: click to rename the deck in place (its folder follows). */
function DeckTitle({ editor, name, onRenamed, editing, setEditing }: {
  editor: Editor; name: string; onRenamed: (name: string) => void; editing: boolean; setEditing: (v: boolean) => void;
}) {
  const [value, setValue] = useState(editor.deck.meta.title);
  const input = useRef<HTMLInputElement>(null);
  const open = useRef(false); // Enter, then the blur of the removed input: rename once
  // entering edit mode is handled during render, not in an effect: an effect runs after paint and
  // would reset what was already typed (fast typing, tests) back to the old title
  const was = useRef(false);
  if (editing !== was.current) {
    was.current = editing;
    open.current = editing;
    if (editing && value !== editor.deck.meta.title) setValue(editor.deck.meta.title);
  }
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  const done = async (keep: boolean) => {
    if (!open.current) return;
    open.current = false;
    setEditing(false);
    const t = value.trim();
    if (!keep || !t || t === editor.deck.meta.title) return;
    try {
      const renamed = await editor.rename(t);
      if (renamed) onRenamed(renamed);
    } catch (e) {
      alert(`The deck was not renamed: ${(e as Error).message}`);
    }
  };
  if (editing) {
    return (
      <input ref={input} class="od-deck-title-input" value={value} aria-label="Deck title"
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => { if (e.key === "Enter") void done(true); if (e.key === "Escape") { e.stopPropagation(); void done(false); } }}
        onBlur={() => void done(true)} />
    );
  }
  return (
    <button class="od-deck-title" title={`${name}: click to rename (the folder follows the title)`} onClick={() => setEditing(true)}>{editor.deck.meta.title}</button>
  );
}

/** A button of the block palette (icon above its label), as in slides.com. */
function Block({ icon, label, aria, tip, on, onClick }: {
  icon: IconName; label: string; aria: string; tip?: string; on?: boolean; onClick: () => void;
}) {
  return (
    <button class={`od-block-btn${on ? " on" : ""}`} aria-label={aria} aria-pressed={on === undefined ? undefined : on}
      data-tip={tip} onClick={onClick}>
      <Icon name={icon} size={22} /><span>{label}</span>
    </button>
  );
}

type Panel = "design" | "layers" | "history";

export function DeckView({ name }: { name: string }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [panel, setPanel] = useState<Panel>("design");
  const [library, setLibrary] = useState(false);
  const [htmlOpen, setHtmlOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [reloads, setReloads] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEditor(null); // never show (or paste into) the previous deck while this one loads
    openEditor(name).then((ed) => {
      setEditor(ed);
      document.title = `${ed.deck.meta.title} · opendeck`;
      window.opendeckFlush = async () => { await ed.save(); return ed.saveState.value === "saved"; };
    }).catch((e) => {
      // renamed in another window: follow it to its new name
      if (e.moved) location.replace(`#/deck/${encodeURIComponent(e.moved)}`);
      else setError(String(e.message ?? e));
    });
    return () => { window.opendeckFlush = undefined; };
  }, [name, reloads]);

  useEffect(() => {
    if (!editor) return;
    const onKey = (e: KeyboardEvent) => {
      if (exporting || library || htmlOpen) return;
      if (e.altKey && e.shiftKey && e.code === "KeyH") { editor.flushText?.(); setHtmlOpen(true); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") { setPanel((p) => (p === "layers" ? "design" : "layers")); e.preventDefault(); return; }
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
        const files = mediaFiles(data);
        if (files.length) void insertMedia(editor, files, editor.deck.meta.width / 2, editor.deck.meta.height / 2);
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
    listRef.current?.querySelector(".od-slide-thumb.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);

  const insert = (make: (s: Slide) => Block) => {
    if (!editor) return;
    let id = "";
    editor.tool.value = null;
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
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dropSlide = (to: number) => {
    setDragOver(null);
    if (!editor || dragFrom === null || dragFrom === to) return;
    const from = dragFrom;
    editor.edit("Move slide", (doc) => moveSlide(doc, from, to));
    editor.current.value = to;
    setDragFrom(null);
  };

  const pickMedia = (accept: string) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => editor && void insertMedia(editor, [...(input.files ?? [])], editor.deck.meta.width / 2, editor.deck.meta.height / 2);
    input.click();
  };

  if (error) {
    return (
      <div class="od-home"><div class="od-empty">
        <Icon name="warning" size={28} />
        <h3>This deck did not open</h3>
        <p>{error}</p>
        <a class="od-btn" href="#/">Back to all decks</a>
      </div></div>
    );
  }
  if (!editor) {
    return (
      <div class="od-editor od-loading" aria-busy="true">
        <nav class="od-rail" />
        <aside class="od-palette-col" />
        <main class="od-center"><div class="od-skel od-skel-canvas" /></main>
        <section class="od-strip">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} class="od-skel od-skel-slide" />)}</section>
        <aside class="od-side" />
      </div>
    );
  }
  const slides = editor.doc.value.slides;
  const state = editor.saveState.value;
  const tool = editor.tool.value;
  const setTool = (t: "line" | "arrow" | "pen") => (editor.tool.value = tool === t ? null : t);
  const zoom = editor.zoom.value;
  const trash = async () => {
    if (!confirm(`Move “${editor.deck.meta.title}” to the trash? It goes to the .trash folder of your decks and can be moved back by hand.`)) return;
    await editor.save(true);
    const r = await fetch(`/api/decks/${encodeURIComponent(name)}`, { method: "DELETE", headers: { "X-Opendeck": "1" } });
    if (r.ok) location.hash = "#/"; else alert(`The deck was not moved: ${(await r.json()).error}`);
  };

  const showPanel = (p: Panel) => setPanel((cur) => (cur === p && p !== "design" ? "design" : p));

  return (
    <div class="od-editor">
      <nav class="od-rail" aria-label="Deck">
        <a class="od-rail-btn" href="#/" data-tip="All decks" aria-label="All decks"><Icon name="decks" size={20} /></a>
        <a class="od-rail-btn od-rail-preview" href={`/view/${encodeURIComponent(name)}/#/${current}`} target="_blank"
          data-tip="Preview" aria-label="Preview"><Icon name="eye" size={20} /></a>
        <button class="od-rail-btn" data-tip="Undo (Ctrl+Z)" aria-label="Undo" onClick={() => editor.undo()}><Icon name="undo" size={20} /></button>
        <button class="od-rail-btn" data-tip="Redo (Ctrl+Y)" aria-label="Redo" onClick={() => editor.redo()}><Icon name="redo" size={20} /></button>
        <button class={`od-rail-btn od-save od-save-${state}`} aria-label={SAVE_LABEL[state]}
          data-tip={`${SAVE_LABEL[state]}. Ctrl+S records a version`} onClick={() => void editor.save(true)}>
          <Icon name={state === "saved" ? "check" : state === "conflict" || state === "error" ? "warning" : "dots"} size={20} />
        </button>
        <span class="od-rail-sep" />
        <button class={`od-rail-btn${panel === "history" ? " on" : ""}`} data-tip="Revision history" aria-label="Revision history"
          onClick={() => showPanel("history")}><Icon name="history" size={20} /></button>
        <button class={`od-rail-btn${panel === "layers" ? " on" : ""}`} data-tip="Layers (Ctrl+O)" aria-label="Show layers"
          onClick={() => showPanel("layers")}><Icon name="layers" size={20} /></button>
        <button class="od-rail-btn" data-tip="Export as PDF or HTML" aria-label="Export"
          onClick={async () => { await editor.save(); setExporting(true); }}><Icon name="export" size={20} /></button>
        <button class="od-rail-btn" data-tip="Media: images from all your decks" aria-label="Image library"
          onClick={() => setLibrary(true)}><Icon name="library" size={20} /></button>
        <button class="od-rail-btn" data-tip="Edit the slide's HTML (Alt+Shift+H)" aria-label="Edit slide HTML"
          onClick={() => { editor.flushText?.(); setHtmlOpen(true); }}><Icon name="code" size={20} /></button>
        <span class="od-rail-fill" />
        <ThemeToggle />
        <Menu label="Deck" items={[
          { label: "Rename deck", icon: "rename", run: () => setRenaming(true) },
          { label: "Show deck folder", icon: "folder", run: () => void api.health().then((h) => api.reveal(`${h.decks_root}/${name}`)) },
          { label: "Move deck to trash", icon: "trash", danger: true, run: () => void trash() },
        ]} />
      </nav>

      <aside class="od-palette-col" aria-label="Insert">
        <div class="od-blocks">
          <Block icon="text" label="Text" aria="Add text" tip="T" onClick={() => { insert((s) => textBlock(s, 212, 250)); editor.pendingEdit.value = editor.selection.value[0]; }} />
          <Block icon="shape" label="Shape" aria="Add shape" onClick={() => insert((s) => shapeBlock(s, 412, 228))} />
          <Block icon="image" label="Image" aria="Add image" tip="Or drop / paste one on the slide" onClick={() => pickMedia("image/*")} />
          <Block icon="video" label="Video" aria="Add video" tip="WebM or MP4; or drop one on the slide" onClick={() => pickMedia("video/webm,video/mp4,.webm,.mp4")} />
          <Block icon="pen" label="Pen" aria="Draw freehand" tip="P, Esc to stop" on={tool === "pen"} onClick={() => setTool("pen")} />
          <Block icon="line" label="Line" aria="Draw a line" tip="L, then drag" on={tool === "line"} onClick={() => setTool("line")} />
          <Block icon="arrow" label="Arrow" aria="Draw an arrow" tip="A, then drag" on={tool === "arrow"} onClick={() => setTool("arrow")} />
          <Block icon="sigma" label="Maths" aria="Add maths" onClick={() => insert((s) => mathBlock(s, 412, 240))} />
        </div>
      </aside>

      <main class="od-center">
        <header class="od-center-head">
          <DeckTitle editor={editor} name={name} editing={renaming} setEditing={setRenaming} onRenamed={(to) => {
            // the page changed on disk (new title, new etag): reopen it, under its new name if it has one
            if (to === name) setReloads((n) => n + 1);
            else location.replace(`#/deck/${encodeURIComponent(to)}`);
          }} />
          <span class={`od-save-text od-save-${state}`} role="status">{SAVE_LABEL[state]}</span>
          <span class="od-head-fill" />
          <span class="od-status">Slide {current + 1} <span>of {slides.length}</span></span>
          <IconButton icon="magnet" label="Snap to alignment guides" size={16} pressed={snapGuides.value}
            tip={`Snap to alignment guides: ${snapGuides.value ? "on" : "off"} (hold Alt while dragging to move freely)`}
            onClick={toggleSnapGuides} />
          <div class="od-zoom" role="group" aria-label="Zoom">
            <IconButton icon="minus" label="Zoom out" tip="Zoom out (−)" size={14} onClick={() => (editor.zoom.value = Math.max(0.25, zoom / 1.25))} />
            <button class="od-zoom-val" data-tip="Fit to the window (0)" onClick={() => (editor.zoom.value = 1)}>
              {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}</button>
            <IconButton icon="plus" label="Zoom in" tip="Zoom in (+)" size={14} onClick={() => (editor.zoom.value = Math.min(4, zoom * 1.25))} />
          </div>
        </header>
        <div class="od-canvas-wrap">
          {slides.length > 0 && <Canvas editor={editor} />}
          {(state === "conflict" || state === "error") && (
            <div class="od-toast" role="alert">
              <Icon name="warning" size={18} />
              <span>{editor.message.value || SAVE_LABEL[state]}</span>
              {state === "conflict" && <button class="od-btn small" onClick={() => setReloads((n) => n + 1)}>Reload the deck</button>}
              {state === "error" && <button class="od-btn small" onClick={() => void editor.save()}>Retry</button>}
            </div>
          )}
        </div>
      </main>

      <section class="od-strip" aria-label="Slides">
        <div class="od-strip-actions">
          <IconButton icon="plus" label="New slide" size={16} onClick={() => slideOp("add")} />
          <IconButton icon="copy" label="Duplicate slide" tip="Duplicate slide (Ctrl+D)" size={16} onClick={() => slideOp("dup")} />
          <IconButton icon="trash" label="Delete slide" tip="Delete slide (Ctrl+Backspace)" size={16} disabled={slides.length < 2} onClick={() => slideOp("del")} />
        </div>
        <div class="od-slide-list" ref={listRef}
          onWheel={(e) => { if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.currentTarget.scrollLeft += e.deltaY; e.preventDefault(); } }}>
          {slides.map((s, i) => (
            <div key={s.id || i} class={`od-slide-slot${dragOver === i && dragFrom !== i ? " drop" : ""}`} draggable
              onDragStart={() => setDragFrom(i)} onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
              onDragOver={(e) => { if (dragFrom !== null) { e.preventDefault(); setDragOver(i); } }}
              onDrop={(e) => { e.preventDefault(); dropSlide(i); }}>
              <SlideThumb html={slideHtml(s)} deck={editor.deck} n={i + 1} active={i === current}
                onClick={() => { editor.flushText?.(); editor.current.value = i; editor.selection.value = []; }} />
            </div>
          ))}
          <button class="od-slide-add" aria-label="New slide at the end" data-tip="New slide at the end"
            onClick={() => { editor.current.value = slides.length - 1; slideOp("add"); }}>
            <Icon name="plus" size={18} /></button>
        </div>
      </section>

      <aside class="od-side" aria-label="Settings">
        <div class="od-tabs" role="tablist">
          {(["design", "layers", "history"] as Panel[]).map((p) => (
            <button role="tab" aria-selected={panel === p} aria-label={p[0].toUpperCase() + p.slice(1)}
              class={panel === p ? "on" : ""} onClick={() => setPanel(p)}>
              {p === "design" ? "Design" : p === "layers" ? "Layers" : "History"}
            </button>
          ))}
        </div>
        <div class="od-side-body">
          {panel === "design" && <Inspector editor={editor} onEditHtml={() => { editor.flushText?.(); setHtmlOpen(true); }} />}
          {panel === "layers" && <Layers editor={editor} />}
          {panel === "history" && <History editor={editor} onRestored={() => { setPanel("design"); setReloads((n) => n + 1); }} />}
        </div>
      </aside>
      {htmlOpen && <SlideHtml editor={editor} onClose={() => setHtmlOpen(false)} />}
      {library && <Library editor={editor} onClose={() => setLibrary(false)} />}
      {exporting && <ExportDialog deck={editor.deck} onClose={() => setExporting(false)} />}
    </div>
  );
}
