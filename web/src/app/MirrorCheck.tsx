// At start-up: the history mirror must be on branch main (the history and the publish whitelist
// live there). On any other branch, offer to switch back; until then the server keeps the
// history and the visibility untouched.
import { useEffect, useState } from "preact/hooks";
import { api, type MirrorState } from "./api";
import { Icon } from "./icons";
import { Modal, ModalHead } from "./ui";

export function MirrorCheck() {
  const [state, setState] = useState<MirrorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { api.mirror().then(setState).catch(() => setState(null)); }, []);
  if (!state || state.ok) return null;
  const close = () => setState(null);
  const run = async () => {
    setBusy(true);
    try {
      await api.switchMirror();
      location.reload();               // the deck list reads the visibility again
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal label="Deck history on the wrong branch" onClose={close} busy={busy} class="od-modal-sm">
      <ModalHead title="Switch the deck history to main?" onClose={close}
        sub={<>The history folder is on branch <code>{state.branch}</code>, not <code>main</code>. Until it is
          switched back, edits are saved but not added to the history, public/private and Publish are
          hidden, and rename, delete and restore are refused.</>} />
      <div class="od-modal-body">
        {!state.can_switch && (
          <p class="od-note od-note-error"><Icon name="warning" size={16} />
            <span>It cannot be switched from here: there is no branch main, or the folder has uncommitted changes.</span></p>
        )}
        {error && <p class="od-note od-note-error"><Icon name="warning" size={16} /><span>{error}</span></p>}
        <footer class="od-modal-foot">
          <button type="button" class="od-btn" onClick={close} disabled={busy}>Not now</button>
          {state.can_switch && (
            <button type="button" class="od-btn primary" onClick={run} disabled={busy}>
              {busy ? "Switching…" : "Switch to main"}</button>
          )}
        </footer>
      </div>
    </Modal>
  );
}
