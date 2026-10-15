// History tab: versions of the deck recorded in the history mirror. View one in a tab, or restore it.
import { useEffect, useState } from "preact/hooks";
import { Icon } from "../app/icons";
import type { Editor } from "./store";

interface Version { rev: string; date: string; message: string }

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function describe(message: string, deck: string): string {
  const m = message.startsWith(`${deck}: `) ? message.slice(deck.length + 2) : message;
  if (m === "edit") return "Edited";
  if (m === "import from slides.com") return "Imported from slides.com";
  if (m.startsWith("restored ")) return `Restored version ${m.slice(9)}`;
  if (m.startsWith("before restoring ")) return "Before a restore";
  if (m === "before re-import") return "Before re-importing";
  return m;
}

export function History({ editor, onRestored }: { editor: Editor; onRestored: () => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState("");
  const load = async () => {
    await editor.save(true);
    const r = await fetch(`/api/decks/${encodeURIComponent(editor.name)}/history`);
    if (r.ok) setVersions(await r.json()); else setError((await r.json()).error ?? r.statusText);
  };
  useEffect(() => { void load(); }, [editor]);

  const restore = async (v: Version) => {
    if (!confirm(`Restore the version of ${day(v.date)}, ${time(v.date)}? The current state stays in the history, so you can come back to it.`)) return;
    const r = await fetch(`/api/decks/${encodeURIComponent(editor.name)}/history/${v.rev}/restore`, {
      method: "POST", headers: { "X-Opendeck": "1" } });
    if (r.ok) onRestored(); else setError((await r.json()).error ?? r.statusText);
  };

  let lastDay = "";
  return (
    <div class="od-history" aria-label="History">
      <p class="od-panel-note">Each version is a saved state of the deck. Ctrl+S records one.</p>
      {error && <p class="od-note od-note-error"><Icon name="warning" size={16} />{error}</p>}
      {!versions && !error && [0, 1, 2].map((i) => <div key={i} class="od-skel od-skel-row" />)}
      {versions?.length === 0 && <p class="od-hint">No version recorded yet.</p>}
      <ol class="od-timeline">
        {versions?.map((v, i) => {
          const d = day(v.date);
          const head = d !== lastDay;
          lastDay = d;
          return (
            <li key={v.rev} class={i === 0 ? "now" : ""}>
              {head && <h5>{d}</h5>}
              <div class="od-version">
                <span class="od-version-dot" aria-hidden="true" />
                <div class="od-version-text">
                  <span class="od-version-when">{time(v.date)}{i === 0 ? <em>Current</em> : null}</span>
                  <span class="od-version-what">{describe(v.message, editor.name)}</span>
                </div>
                <a href={`/history/${encodeURIComponent(editor.name)}/${v.rev}/`} target="_blank" title="Open this version in a tab"
                  aria-label="View this version"><Icon name="open" size={14} /></a>
                {i > 0 && <button class="od-btn small" onClick={() => restore(v)}>Restore</button>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
