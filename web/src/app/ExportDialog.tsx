// Export a deck as PDF or HTML into a folder below the export root, chosen with the native
// folder dialog. Destinations used before are offered first ("Export again").
import { useEffect, useState } from "preact/hooks";
import { api, type Deck, type RememberedExport } from "./api";
import { Icon, type IconName } from "./icons";
import { Modal, ModalHead } from "./ui";

type Kind = "pdf" | "html" | "zip" | "single";

const KINDS: Record<Kind, { label: string; icon: IconName; note: string }> = {
  pdf: { label: "PDF", icon: "pdf", note: "One page per slide" },
  html: { label: "HTML folder", icon: "folder", note: "Opens in any browser" },
  zip: { label: "HTML zip", icon: "zip", note: "The folder, zipped" },
  single: { label: "Single file", icon: "html", note: "One .html, images inside" },
};
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
    <Modal label="Export" onClose={onClose} busy={busy} class="od-export">
      <ModalHead title="Export" sub={deck.meta.title} onClose={onClose} />
      <div class="od-modal-body">
        {remembered.length > 0 && (
          <section class="od-again">
            <h3>Export again</h3>
            {remembered.slice(0, 4).map((r) => (
              <button class="od-again-btn" disabled={busy} onClick={() => run(true, kindOf(r), r.dir, r.name)} title={`${r.dir}/${r.name}`}>
                <Icon name={KINDS[kindOf(r)].icon} size={18} />
                <span class="od-again-path">{rel(r.dir)}/<b>{r.name}</b></span>
                <span class="od-again-kind">{KINDS[kindOf(r)].label}</span>
              </button>
            ))}
          </section>
        )}
        <section class="od-form">
          <h3>{remembered.length ? "Or choose" : "Format"}</h3>
          <div class="od-kinds" role="radiogroup" aria-label="Format">
            {(Object.keys(KINDS) as Kind[]).map((k) => (
              <label class={kind === k ? "on" : ""}>
                <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
                <Icon name={KINDS[k].icon} size={22} />
                <b>{KINDS[k].label}</b>
                <small>{KINDS[k].note}</small>
              </label>
            ))}
          </div>
          <div class="od-field">
            <span>Folder</span>
            <button class="od-path" onClick={choose} disabled={busy}>
              <Icon name="folder" size={16} />
              {dir ? <span>{rel(dir)}</span> : <span class="od-placeholder">Choose a folder in your presentations</span>}
              <em>Choose</em>
            </button>
          </div>
          <label class="od-field">
            <span>Name</span>
            <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
        </section>
        {busy && <div class="od-progress" role="progressbar" aria-label="Exporting"><i /></div>}
        {result.error && (
          <p class="od-note od-note-error">
            <Icon name="warning" size={16} />
            <span>{result.error}</span>
            {result.exists && <button class="od-btn small" onClick={() => run(true)}>Overwrite</button>}
          </p>
        )}
        {result.path && (
          <p class="od-note od-note-ok">
            <Icon name="check" size={16} />
            <span>Exported to {rel(result.path)}</span>
            <button class="od-btn small" onClick={() => api.reveal(result.path!)}>Show in folder</button>
          </p>
        )}
        <footer class="od-modal-foot">
          <button class="od-btn" onClick={onClose} disabled={busy}>Close</button>
          <button class="od-btn primary" disabled={busy || !dir || !name.trim()} onClick={() => run(false)}>
            {busy ? "Exporting" : `Export ${KINDS[kind].label}`}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
