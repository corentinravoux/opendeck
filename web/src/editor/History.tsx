// Versions of the deck recorded in the history mirror: view one in a tab, or restore it.
import { useEffect, useState } from "preact/hooks";
import type { Editor } from "./store";

interface Version { rev: string; date: string; message: string }

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

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
    if (!confirm(`Restore the version of ${when(v.date)}? The current state stays in the history, so you can come back to it.`)) return;
    const r = await fetch(`/api/decks/${encodeURIComponent(editor.name)}/history/${v.rev}/restore`, {
      method: "POST", headers: { "X-Opendeck": "1" } });
    if (r.ok) onRestored(); else setError((await r.json()).error ?? r.statusText);
  };

  return (
    <section class="od-layers od-history" aria-label="History">
      <h3>History</h3>
      {error && <p class="od-error">{error}</p>}
      {!versions && !error && <p class="od-hint">Loading versions…</p>}
      {versions?.length === 0 && <p class="od-hint">No version recorded yet. Ctrl+S records one.</p>}
      {versions?.map((v, i) => (
        <div class="od-version" key={v.rev}>
          <div>
            <div class="od-version-when">{when(v.date)}{i === 0 ? " (current)" : ""}</div>
            <div class="od-hint">{describe(v.message, editor.name)}</div>
          </div>
          <a href={`/history/${encodeURIComponent(editor.name)}/${v.rev}/`} target="_blank" title="Open this version in a tab">View</a>
          {i > 0 && <button onClick={() => restore(v)}>Restore</button>}
        </div>
      ))}
    </section>
  );
}
