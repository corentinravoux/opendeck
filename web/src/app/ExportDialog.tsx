// Export a deck as PDF or HTML into a folder below the export root, chosen with the native
// folder dialog. Destinations used before are offered first ("Export again").
import { useEffect, useState } from "preact/hooks";
import { api, type Deck, type RememberedExport } from "./api";

type Kind = "pdf" | "html" | "zip" | "single";

const label = (k: Kind) => ({ pdf: "PDF", html: "HTML folder", zip: "HTML zip", single: "Single HTML file" })[k];
const kindOf = (r: RememberedExport): Kind => ((r.kind as string) === "single" ? "single" : r.kind === "pdf" ? "pdf" : r.zip ? "zip" : "html");

export function ExportDialog({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>("pdf");
  const [dir, setDir] = useState("");
  const [name, setName] = useState(deck.name);
  const [remembered, setRemembered] = useState<RememberedExport[]>([]);
  const [root, setRoot] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ path?: string; error?: string; exists?: boolean }>({});

  useEffect(() => {
    api.exports(deck.name).then((r) => {
      setRemembered(r);
      if (r[0]) {
        setDir(r[0].dir);
        setName(r[0].name);
        setKind(kindOf(r[0]));
      }
    });
    api.health().then((h) => setRoot(h.export_root));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [deck.name]);

  const choose = async () => {
    const { path } = await api.pickFolder(dir || root).catch((e) => {
      setResult({ error: String(e.message ?? e) });
      return { path: null };
    });
    if (path) setDir(path);
  };

  const run = async (overwrite = false, k = kind, d = dir, n = name) => {
    setBusy(true);
    setResult({});
    try {
      const r = await api.exportDeck(deck.name, { kind: k === "pdf" ? "pdf" : "html", dir: d, name: n, zip: k === "zip", single: k === "single", overwrite });
      setResult({ path: r.path });
      setRemembered(await api.exports(deck.name));
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      setResult({ error: msg, exists: msg.includes("already exists") });
    } finally {
      setBusy(false);
    }
  };

  const rel = (p: string) => (root && p.startsWith(root) ? p.slice(root.length).replace(/^\//, "") || "." : p);

  return (
    <div class="od-modal-back" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div class="od-modal" role="dialog" aria-label="Export">
        <h2>Export “{deck.meta.title}”</h2>
        {remembered.length > 0 && (
          <section class="od-again">
            <h3>Export again to</h3>
            {remembered.slice(0, 4).map((r) => (
              <button class="od-again-btn" disabled={busy} onClick={() => run(true, kindOf(r), r.dir, r.name)}
                title={`${r.dir}/${r.name}`}>
                <b>{label(kindOf(r))}</b><span>{rel(r.dir)}/{r.name}</span>
              </button>
            ))}
          </section>
        )}
        <section class="od-form">
          <div class="od-kinds">
            {(["pdf", "html", "zip", "single"] as Kind[]).map((k) => (
              <label class={kind === k ? "on" : ""}>
                <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} /> {label(k)}
              </label>
            ))}
          </div>
          <label class="od-field">
            <span>Folder</span>
            <div class="od-row">
              <input readOnly value={dir ? rel(dir) : ""} placeholder="Choose a folder in your presentations" onClick={choose} />
              <button onClick={choose} disabled={busy}>Choose…</button>
            </div>
          </label>
          <label class="od-field">
            <span>File name</span>
            <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
        </section>
        {result.error && (
          <p class="od-error">
            {result.error}
            {result.exists && <button onClick={() => run(true)}>Overwrite</button>}
          </p>
        )}
        {result.path && (
          <p class="od-ok">
            Exported to {rel(result.path)} <button onClick={() => api.reveal(result.path!)}>Show in folder</button>
          </p>
        )}
        <footer>
          <button onClick={onClose} disabled={busy}>Close</button>
          <button class="primary" disabled={busy || !dir || !name.trim()} onClick={() => run(false)}>
            {busy ? "Exporting" : `Export ${label(kind)}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
