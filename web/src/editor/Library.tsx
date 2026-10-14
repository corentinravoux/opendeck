// Images from all decks: pick one to place it on the current slide (copied into this deck).
import { useEffect, useMemo, useState } from "preact/hooks";
import { imageBlock } from "../model/factory";
import { Icon } from "../app/icons";
import type { Editor } from "./store";

interface Item { deck: string; title: string; src: string; bytes: number }

async function place(editor: Editor, item: Item): Promise<void> {
  if (item.deck !== editor.name) {
    const r = await fetch(`/api/decks/${encodeURIComponent(editor.name)}/media/copy`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Opendeck": "1" },
      body: JSON.stringify({ from: item.deck, srcs: [item.src] }),
    });
    if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
  }
  const img = new Image();
  img.src = `/view/${encodeURIComponent(editor.name)}/${item.src}`;
  await img.decode().catch(() => undefined);
  const { width: W, height: H } = editor.deck.meta;
  const nw = img.naturalWidth || 400, nh = img.naturalHeight || 300;
  const fit = Math.min(1, (0.8 * W) / nw, (0.8 * H) / nh);
  const w = nw * fit, h = nh * fit;
  let id = "";
  editor.edit("Insert image", (doc) => {
    const s = doc.slides[editor.current.value];
    const b = imageBlock(s, item.src, (W - w) / 2, (H - h) / 2, w, h, { width: nw, height: nh });
    s.items.push({ kind: "block", block: b });
    s.dirty = true;
    id = b.id;
  });
  editor.selection.value = [id];
}

export function Library({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/library").then((r) => r.json()).then(setItems).catch((e) => setError(String(e)));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const by = new Map<string, Item[]>();
    for (const it of items ?? []) {
      if (q && !it.title.toLowerCase().includes(q) && !it.deck.toLowerCase().includes(q)) continue;
      by.set(it.deck, [...(by.get(it.deck) ?? []), it]);
    }
    // the current deck first
    return [...by.entries()].sort(([a], [b]) => (a === editor.name ? -1 : b === editor.name ? 1 : 0));
  }, [items, filter]);

  return (
    <div class="od-modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="od-modal od-library" role="dialog" aria-label="Images from your decks">
        <header class="od-library-head">
          <h2>Images from your decks</h2>
          <label class="od-search">
            <Icon name="search" size={18} />
            <input placeholder="Filter by deck" aria-label="Filter by deck" value={filter} autoFocus
              onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
          </label>
          <button class="od-icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </header>
        {error && <p class="od-error">{error}</p>}
        {!items && !error && <p class="od-hint">Loading images…</p>}
        <div class="od-library-body">
          {groups.map(([deck, list]) => (
            <section key={deck}>
              <h3>{list[0].title}{deck === editor.name ? " (this deck)" : ""}</h3>
              <div class="od-library-grid">
                {list.map((it) => (
                  <button key={it.src} class="od-library-item" title={`Place on the slide (${Math.round(it.bytes / 1024)} kB)`}
                    onClick={() => place(editor, it).then(onClose, (e) => setError(String(e.message ?? e)))}>
                    <img loading="lazy" alt="" src={`/api/thumb/${encodeURIComponent(deck)}/${it.src.slice(6)}?w=240`} />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
