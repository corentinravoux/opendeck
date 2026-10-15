// Deck browser: the decks edited most recently, then every deck by year, each shown by its
// first slide.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api, type DeckInfo } from "./api";
import { Icon } from "./icons";
import { renderSlide } from "./slide";
import { Modal, ModalHead, ThemeToggle } from "./ui";

function Thumb({ deck }: { deck: DeckInfo }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        const meta = { title: deck.title, width: deck.width, height: deck.height, theme_font: deck.theme_font,
                       theme_color: deck.theme_color, slide_number: false, macros: {} };
        renderSlide(el, deck.first, deck.name, meta, el.getBoundingClientRect().width || 260);
        el.classList.add("ready");
        io.disconnect();
      }
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [deck]);
  return <div class="od-thumb" ref={ref} />;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const yearOf = (d: DeckInfo) => d.name.slice(0, 4);
const monthOf = (d: DeckInfo) => MONTHS[Number(d.name.slice(5, 7)) - 1] ?? "";

function edited(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days)) return "";
  if (days < 1) return "Edited today";
  if (days < 2) return "Edited yesterday";
  if (days < 30) return `Edited ${days} days ago`;
  return `Edited ${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

function Card({ deck, recent = false, onDuplicate }: { deck: DeckInfo; recent?: boolean; onDuplicate: (d: DeckInfo) => void }) {
  return (
    <div class="od-card-wrap">
      <a href={`#/deck/${encodeURIComponent(deck.name)}`} class="od-card" title={deck.name}>
        <Thumb deck={deck} />
        <div class="od-card-title">{deck.title}</div>
        <div class="od-card-meta">
          <span>{recent ? edited(deck.modified) : `${monthOf(deck)} ${yearOf(deck)}`}</span>
          <span>{deck.slides} slides</span>
        </div>
      </a>
      <div class="od-card-actions">
        <button class="od-btn small" aria-label={`Duplicate “${deck.title}”`} onClick={() => onDuplicate(deck)}>
          <Icon name="copy" size={14} />Duplicate</button>
      </div>
    </div>
  );
}

/** Create a deck: an empty one, or a copy of `source` (slides and images). */
function NewDeck({ source, onClose }: { source?: DeckInfo; onClose: () => void }) {
  const [title, setTitle] = useState(source ? `${source.title} (copy)` : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async (e: Event) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const url = source ? `/api/decks/${encodeURIComponent(source.name)}/duplicate` : "/api/decks";
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Opendeck": "1" },
      body: JSON.stringify({ title: title.trim() }) });
    const body = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) location.hash = `#/deck/${encodeURIComponent(body.name)}`;
    else setError(body.error ?? r.statusText);
  };
  return (
    <Modal label={source ? "Duplicate deck" : "New deck"} onClose={onClose} busy={busy} class="od-modal-sm">
      <ModalHead title={source ? "Duplicate deck" : "New deck"} onClose={onClose}
        sub={source ? `A copy of “${source.title}”, with its slides and images, filed under this month.`
          : "A 1024 × 576 deck, filed under this month."} />
      <form class="od-modal-body" onSubmit={create}>
        <label class="od-field">
          <span>Title</span>
          <input value={title} placeholder="Growth rate from peculiar velocities" autofocus
            onFocus={(e) => (e.target as HTMLInputElement).select()}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        </label>
        {error && <p class="od-note od-note-error"><Icon name="warning" size={16} />{error}</p>}
        <footer class="od-modal-foot">
          <button type="button" class="od-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" class="od-btn primary" disabled={busy || !title.trim()}>{busy ? (source ? "Copying" : "Creating") : source ? "Duplicate" : "Create deck"}</button>
        </footer>
      </form>
    </Modal>
  );
}

function Skeleton() {
  return (
    <section class="od-year" aria-hidden="true">
      <h2><span class="od-skel" style={{ width: "64px", height: "22px" }} /></h2>
      <ul class="od-grid">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <li key={i}><div class="od-thumb od-skel" /><span class="od-skel od-skel-line" /><span class="od-skel od-skel-line short" /></li>
        ))}
      </ul>
    </section>
  );
}

export function DeckList() {
  const [decks, setDecks] = useState<DeckInfo[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [copying, setCopying] = useState<DeckInfo | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = "opendeck";
    api.decks().then(setDecks).catch((e) => setError(String(e.message ?? e)));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target as HTMLElement).closest("input, textarea")) { e.preventDefault(); search.current?.focus(); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const q = filter.trim().toLowerCase();
  const years = useMemo(() => {
    const shown = (decks ?? []).filter((d) => !q || d.title.toLowerCase().includes(q) || d.name.toLowerCase().includes(q));
    const by = new Map<string, DeckInfo[]>();
    for (const d of shown) by.set(yearOf(d), [...(by.get(yearOf(d)) ?? []), d]);
    return [...by.entries()];
  }, [decks, q]);
  const recent = useMemo(() => [...(decks ?? [])].sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 4), [decks]);

  return (
    <div class="od-home">
      <header class="od-home-bar">
        <div class="od-brand">
          <span class="od-brand-mark" aria-hidden="true" />
          <span class="od-brand-name">opendeck</span>
        </div>
        <label class="od-search">
          <Icon name="search" size={16} />
          <input ref={search} placeholder={decks ? `Search ${decks.length} decks` : "Search decks"} aria-label="Find a deck"
            value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Escape" && setFilter("")} />
          {filter
            ? <button class="od-search-clear" aria-label="Clear the search" onClick={() => setFilter("")}><Icon name="close" size={14} /></button>
            : <kbd>/</kbd>}
        </label>
        <div class="od-home-actions">
          <ThemeToggle />
          <button class="od-btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />New deck</button>
        </div>
      </header>

      <main class="od-home-body">
        {error && (
          <div class="od-empty">
            <Icon name="warning" size={28} />
            <h3>The deck list did not load</h3>
            <p>{error}</p>
            <button class="od-btn" onClick={() => location.reload()}>Try again</button>
          </div>
        )}
        {!decks && !error && <Skeleton />}
        {decks && decks.length === 0 && (
          <div class="od-empty">
            <span class="od-brand-mark big" aria-hidden="true" />
            <h3>No decks yet</h3>
            <p>Your decks folder is empty. Start a deck here, or bring your slides.com decks over with <code>opendeck migrate</code>.</p>
            <button class="od-btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />New deck</button>
          </div>
        )}
        {decks && decks.length > 0 && years.length === 0 && (
          <div class="od-empty">
            <Icon name="search" size={28} />
            <h3>No deck matches “{filter}”</h3>
            <p>The search looks at deck titles and folder names.</p>
            <button class="od-btn" onClick={() => setFilter("")}>Clear the search</button>
          </div>
        )}
        {!q && recent.length > 0 && (
          <section class="od-recent" aria-label="Recently edited">
            <h2 class="od-eyebrow">Recently edited</h2>
            <ul class="od-grid od-grid-recent">
              {recent.map((d) => <li key={d.name}><Card deck={d} recent onDuplicate={setCopying} /></li>)}
            </ul>
          </section>
        )}
        {years.map(([year, list]) => (
          <section class="od-year" key={year} aria-label={year}>
            <h2><span>{year}</span><small>{list.length} {list.length === 1 ? "deck" : "decks"}</small></h2>
            <ul class="od-grid">
              {list.map((d) => <li key={d.name}><Card deck={d} onDuplicate={setCopying} /></li>)}
            </ul>
          </section>
        ))}
      </main>
      {creating && <NewDeck onClose={() => setCreating(false)} />}
      {copying && <NewDeck source={copying} onClose={() => setCopying(null)} />}
    </div>
  );
}
