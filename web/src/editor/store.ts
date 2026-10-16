// Editor state: the document, the current slide, the selection, undo/redo, autosave.
import { signal } from "@preact/signals";
import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer";
import { api, type Deck } from "../app/api";
import { parseDoc } from "../model/parse";
import { serializeDoc } from "../model/serialize";
import type { Doc } from "../model/types";

enablePatches();

interface Entry { label: string; patches: Patch[]; inverse: Patch[]; at: number; key?: string; selection: string[] }

export type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";

export class Editor {
  readonly name: string;
  readonly deck: Deck;
  readonly doc = signal<Doc>({ slides: [], tail: "" });
  readonly current = signal(0);
  readonly selection = signal<string[]>([]);
  readonly saveState = signal<SaveState>("saved");
  readonly message = signal("");
  /** id of a block to open for text editing once rendered (set when inserting a text block) */
  readonly pendingEdit = signal<string | null>(null);
  /** a drawing tool waiting for a drag on the slide */
  readonly tool = signal<"line" | "arrow" | "pen" | null>(null);
  /** pen colour and thickness, kept between strokes */
  readonly pen = signal({ colour: "#cc0000", size: 4 });
  /** canvas zoom relative to "fit the window" (1) */
  readonly zoom = signal(1);
  /** set by the canvas while a text block is being edited: commits it into the document */
  flushText: (() => void) | null = null;
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private etag: string;
  private timer: number | undefined;
  private saving: Promise<void> | null = null;
  /** set while the deck is renamed: edits are refused, since the editor is replaced afterwards */
  private renaming = false;

  constructor(deck: Deck) {
    this.name = deck.name;
    this.deck = deck;
    this.etag = deck.etag;
    this.doc.value = parseDoc(deck.slides);
  }

  get slide() {
    return this.doc.value.slides[this.current.value];
  }

  /** Apply an edit to the document, recording it for undo. Edits with the same `key` within
   *  600 ms are merged into one undo step (dragging, nudging with the arrow keys). */
  edit(label: string, recipe: (doc: Doc) => void, key?: string): void {
    if (this.renaming) return;
    const [next, patches, inverse] = produceWithPatches(this.doc.value, recipe);
    if (!patches.length) return;
    this.doc.value = next;
    const now = Date.now();
    const last = this.undoStack[this.undoStack.length - 1];
    if (key && last && last.key === key && now - last.at < 600) {
      last.patches.push(...patches);
      last.inverse.unshift(...inverse);
      last.at = now;
    } else {
      this.undoStack.push({ label, patches, inverse, at: now, key, selection: this.selection.value });
      if (this.undoStack.length > 500) this.undoStack.shift();
    }
    this.redoStack = [];
    this.changed();
  }

  undo(): void {
    if (this.renaming) return;
    const e = this.undoStack.pop();
    if (!e) return;
    this.doc.value = applyPatches(this.doc.value, e.inverse);
    this.redoStack.push(e);
    this.selection.value = e.selection;
    this.changed();
  }

  redo(): void {
    if (this.renaming) return;
    const e = this.redoStack.pop();
    if (!e) return;
    this.doc.value = applyPatches(this.doc.value, e.patches);
    this.undoStack.push(e);
    this.changed();
  }

  private changed(): void {
    this.saveState.value = "dirty";
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.save(), 1200);
  }

  /** Change deck metadata (e.g. its title): written with the slides, recorded in the history. */
  async setMeta(patch: Record<string, unknown>): Promise<void> {
    this.flushText?.();
    await this.save();
    const r = await fetch(`/api/decks/${encodeURIComponent(this.name)}`, {
      method: "PUT", headers: { "Content-Type": "application/json", "X-Opendeck": "1" },
      body: JSON.stringify({ slides: serializeDoc(this.doc.value), etag: this.etag, meta: patch, commit: true }),
    });
    const body = await r.json();
    if (!r.ok) { this.message.value = body.error; this.saveState.value = "error"; return; }
    this.etag = body.etag;
    Object.assign(this.deck.meta, patch);
  }

  /** Give the deck a new title; its folder is renamed to match (YYYY-MM_<slug>), and its history
   *  follows. Saves first. Returns the deck's name afterwards (the caller reopens the deck under it,
   *  since its etag changed), or null when the deck could not be saved first. From the save on,
   *  the document takes no edit: one made then would be lost when the deck is reopened. After a
   *  rename it stays so, since this editor is replaced; after a failure it is editable again. */
  async rename(title: string): Promise<string | null> {
    this.flushText?.();
    this.renaming = true;
    try {
      await this.save();
      if (this.saveState.value !== "saved") { this.renaming = false; return null; }
      return (await api.renameDeck(this.name, title)).name;
    } catch (err) {
      this.renaming = false;
      throw err;
    }
  }

  /** Write the deck now; `commit` also records it in the history mirror (Ctrl+S). */
  async save(commit = false): Promise<void> {
    this.flushText?.();
    clearTimeout(this.timer);
    if (this.saving) await this.saving;
    if (this.saveState.value === "saved" && !commit) return;
    if (this.saveState.value === "conflict") return;
    const slides = serializeDoc(this.doc.value);
    this.saveState.value = "saving";
    this.saving = (async () => {
      try {
        const r = await fetch(`/api/decks/${encodeURIComponent(this.name)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-Opendeck": "1" },
          body: JSON.stringify({ slides, etag: this.etag, commit }),
          keepalive: slides.length < 60_000,
        });
        const body = await r.json();
        if (r.status === 409 || (r.status === 404 && body.moved)) {
          // 404 + moved: another window renamed the deck; reloading opens it under its new name
          this.saveState.value = "conflict";
          this.message.value = body.error;
          return;
        }
        if (!r.ok) throw new Error(body.error ?? r.statusText);
        this.etag = body.etag;
        this.saveState.value = serializeDoc(this.doc.value) === slides ? "saved" : "dirty";
        if (this.saveState.value === "dirty") this.changed();
      } catch (err) {
        this.saveState.value = "error";
        this.message.value = String((err as Error).message ?? err);
      } finally {
        this.saving = null;
      }
    })();
    await this.saving;
  }
}

export async function openEditor(name: string): Promise<Editor> {
  return new Editor(await api.deck(name));
}
