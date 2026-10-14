// Deck browser: your decks by year, newest first, each shown by its first slide.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api, type DeckInfo } from "./api";
import { Icon } from "./icons";
import { renderSlide } from "./slide";

function Thumb({ deck }: { deck: DeckInfo }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        const meta = { title: deck.title, width: deck.width, height: deck.height, theme_font: deck.theme_font,
                       theme_color: deck.theme_color, slide_number: false, macros: {} };
        renderSlide(el, deck.first, deck.name, meta, el.getBoundingClientRect().width || 232);
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

export function DeckList() {
  const [decks, setDecks] = useState<DeckInfo[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    document.title = "opendeck";
    api.decks().then(setDecks).catch((e) => setError(String(e.message ?? e)));
  }, []);

  const years = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const shown = (decks ?? []).filter((d) => !q || d.title.toLowerCase().includes(q) || d.name.toLowerCase().includes(q));
    const by = new Map<string, DeckInfo[]>();
    for (const d of shown) by.set(yearOf(d), [...(by.get(yearOf(d)) ?? []), d]);
    return [...by.entries()];
  }, [decks, filter]);

  return (
    <main class="od-list">
      <header class="od-list-head">
        <h1>opendeck</h1>
        <span class="od-count">{decks ? `${decks.length} decks` : ""}</span>
        <button class="primary od-new" onClick={async () => {
          const title = prompt("Title of the new deck");
          if (!title?.trim()) return;
          const r = await fetch("/api/decks", { method: "POST", headers: { "Content-Type": "application/json", "X-Opendeck": "1" },
            body: JSON.stringify({ title }) });
          const body = await r.json();
          if (r.ok) location.hash = `#/deck/${encodeURIComponent(body.name)}`; else alert(`The deck was not created: ${body.error}`);
        }}>New deck</button>
        <label class="od-search">
          <Icon name="search" size={18} />
          <input placeholder="Find a deck" aria-label="Find a deck" value={filter} autoFocus
            onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
        </label>
      </header>
      {error && <p class="od-error">The deck list did not load: {error}</p>}
      {!decks && !error && <p class="od-muted">Loading decks…</p>}
      {decks && years.length === 0 && <p class="od-empty">No deck title contains “{filter}”.</p>}
      {years.map(([year, list]) => (
        <section class="od-year" key={year} aria-label={year}>
          <h2>{year}</h2>
          <ul class="od-grid">
            {list.map((d) => (
              <li key={d.name}>
                <a href={`#/deck/${encodeURIComponent(d.name)}`} class="od-card" title={d.name}>
                  <Thumb deck={d} />
                  <div class="od-card-title">{d.title}</div>
                  <div class="od-card-meta"><span>{monthOf(d)}</span><span>{d.slides} slides</span></div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
