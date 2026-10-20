// Deck browser: the decks edited most recently, then every deck by year, each shown by its
// first slide.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api, type DeckInfo, type Publishing } from "./api";
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

function Card({ deck, recent = false, onDuplicate, onRename, onVisibility }: {
  deck: DeckInfo; recent?: boolean; onDuplicate: (d: DeckInfo) => void; onRename: (d: DeckInfo) => void;
  onVisibility: (d: DeckInfo) => void;
}) {
  return (
    <div class="od-card-wrap">
      <a href={`#/deck/${encodeURIComponent(deck.name)}`} class="od-card" title={deck.name}>
        <Thumb deck={deck} />
        <div class="od-card-title">{deck.title}</div>
        <div class="od-card-meta">
          <span>{recent ? edited(deck.modified) : `${monthOf(deck)} ${yearOf(deck)}`}</span>
          <span>{deck.slides} slides</span>
          {deck.public && <span class="od-public" title="Public: on the website after the next Publish"><Icon name="globe" size={13} />Public</span>}
        </div>
      </a>
        {deck.public !== undefined && (
          <div class="od-card-vis">
            <label class="od-check od-vis" title={deck.public ? "Public: on the published website. Slide to make it private."
              : "Private: never published. Slide to make it public."}>
              <span class={deck.public ? "" : "on"}><Icon name="lock" size={13} />Private</span>
              <input type="checkbox" role="switch" checked={deck.public}
                aria-label={`“${deck.title}” is ${deck.public ? "public" : "private"}`}
                onChange={(e) => { (e.target as HTMLInputElement).checked = !!deck.public; onVisibility(deck); }} />
              <span class="od-switch" aria-hidden="true" />
              <span class={deck.public ? "on" : ""}><Icon name="globe" size={13} />Public</span>
            </label>
          </div>
        )}
      <div class="od-card-actions">
        <button class="od-btn small" aria-label={`Duplicate “${deck.title}”`} onClick={() => onDuplicate(deck)}>
          <Icon name="copy" size={14} />Duplicate</button>
        <button class="od-btn small" aria-label={`Rename “${deck.title}”`} onClick={() => onRename(deck)}>
          <Icon name="rename" size={14} />Rename</button>
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

/** Rename a deck: a new title, and its folder renamed to match (same month); its history follows. */
function RenameDeck({ deck, onClose, onDone }: { deck: DeckInfo; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(deck.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: Event) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    if (t === deck.title) { onClose(); return; }
    setBusy(true);
    try {
      await api.renameDeck(deck.name, t);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal label="Rename deck" onClose={onClose} busy={busy} class="od-modal-sm">
      <ModalHead title="Rename deck" onClose={onClose}
        sub={<>Its folder <code>{deck.name}</code> is renamed to match the title. Its history follows it.</>} />
      <form class="od-modal-body" onSubmit={submit}>
        <label class="od-field">
          <span>Title</span>
          <input value={title} autofocus onFocus={(e) => (e.target as HTMLInputElement).select()}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        </label>
        {error && <p class="od-note od-note-error"><Icon name="warning" size={16} />{error}</p>}
        <footer class="od-modal-foot">
          <button type="button" class="od-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" class="od-btn primary" disabled={busy || !title.trim()}>{busy ? "Renaming" : "Rename"}</button>
        </footer>
      </form>
    </Modal>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric",
                                                                       hour: "2-digit", minute: "2-digit" });

/** Push the public decks to the website: the editor's `opendeck publish`. */
function PublishSite({ info, onClose, onDone }: { info: Publishing; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.publish();
      setDone(r.changed ? `Published ${r.decks} decks (snapshot ${r.snapshot}).`
        : `Already up to date: the site has these ${r.decks} decks.`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  const n = info.public ?? 0;
  return (
    <Modal label="Publish the website" onClose={onClose} busy={busy} class="od-modal-sm">
      <ModalHead title="Publish the website" onClose={onClose}
        sub={<>Pushes the {n} public {n === 1 ? "deck" : "decks"} as they are now{info.site ? <> to <code>{info.site.replace(/^https?:\/\//, "")}</code></> : null}. Private decks never leave this computer.</>} />
      <div class="od-modal-body">
        <p class="od-hint">{info.last ? `Last published ${when(info.last)}.` : "Never published from this computer."}</p>
        {done && <p class="od-note od-note-ok"><Icon name="check" size={16} /><span>{done}</span></p>}
        {error && <p class="od-note od-note-error"><Icon name="warning" size={16} /><span>{error}</span></p>}
        <footer class="od-modal-foot">
          <button type="button" class="od-btn" onClick={onClose} disabled={busy}>{done ? "Close" : "Cancel"}</button>
          {!done && <button type="button" class="od-btn primary" onClick={run} disabled={busy}>
            <Icon name="publish" size={16} />{busy ? "Publishing…" : "Publish"}</button>}
        </footer>
      </div>
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
  const [renaming, setRenaming] = useState<DeckInfo | null>(null);
  const [publishing, setPublishing] = useState<Publishing | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const refreshPublishing = () => void api.publishing().then(setPublishing).catch(() => setPublishing(null));
  const search = useRef<HTMLInputElement>(null);

  // private -> public is rare and publishes the deck: ask first; public -> private does not
  const toggleVisibility = async (d: DeckInfo) => {
    const next = !d.public;
    if (next && !confirm(`Make “${d.title}” public?\n\nIt will be on the website after the next Publish.`)) return;
    try {
      await api.setVisibility(d.name, next);
      setDecks((all) => all && all.map((x) => (x.name === d.name ? { ...x, public: next } : x)));
      refreshPublishing();
    } catch (e) {
      alert(String((e as Error).message ?? e));
    }
  };

  useEffect(() => {
    document.title = "opendeck";
    api.decks().then(setDecks).catch((e) => setError(String(e.message ?? e)));
    refreshPublishing();
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
          {publishing?.enabled && (
            <button class="od-btn" onClick={() => setPublishOpen(true)}
              title={publishing.last ? `Push the public decks to the website. Last published ${when(publishing.last)}.`
                : "Push the public decks to the website."}>
              <Icon name="publish" size={16} />Publish
            </button>
          )}
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
              {recent.map((d) => <li key={d.name}><Card deck={d} recent onDuplicate={setCopying} onRename={setRenaming} onVisibility={toggleVisibility} /></li>)}
            </ul>
          </section>
        )}
        {years.map(([year, list]) => (
          <section class="od-year" key={year} aria-label={year}>
            <h2><span>{year}</span><small>{list.length} {list.length === 1 ? "deck" : "decks"}</small></h2>
            <ul class="od-grid">
              {list.map((d) => <li key={d.name}><Card deck={d} onDuplicate={setCopying} onRename={setRenaming} onVisibility={toggleVisibility} /></li>)}
            </ul>
          </section>
        ))}
      </main>
      {creating && <NewDeck onClose={() => setCreating(false)} />}
      {copying && <NewDeck source={copying} onClose={() => setCopying(null)} />}
      {publishOpen && publishing && <PublishSite info={publishing} onClose={() => setPublishOpen(false)} onDone={refreshPublishing} />}
      {renaming && <RenameDeck deck={renaming} onClose={() => setRenaming(null)}
        onDone={() => { setRenaming(null); void api.decks().then(setDecks); }} />}
    </div>
  );
}
