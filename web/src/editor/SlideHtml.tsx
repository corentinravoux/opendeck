// Edit the HTML of the current slide directly (Alt+Shift+H), as in slides.com.
import { useState } from "preact/hooks";
import { Icon } from "../app/icons";
import { Modal, ModalHead } from "../app/ui";
import { parseSection } from "../model/parse";
import { slideHtml } from "../model/serialize";
import type { Editor } from "./store";

export function SlideHtml({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [html, setHtml] = useState(() => slideHtml(editor.slide));
  const [error, setError] = useState("");
  const apply = () => {
    let parsed;
    try {
      parsed = parseSection(html.trim());
    } catch {
      setError("The HTML must be one <section> element (one slide).");
      return;
    }
    const at = editor.current.value;
    editor.edit("Edit slide HTML", (doc) => {
      const old = doc.slides[at];
      doc.slides[at] = { ...parsed, before: old.before, dirty: true };
    });
    editor.selection.value = [];
    onClose();
  };
  return (
    <Modal label="Slide HTML" onClose={onClose} class="od-html">
      <ModalHead title={`HTML of slide ${editor.current.value + 1}`} sub="One <section>; Ctrl+Z undoes the change." onClose={onClose} />
      <div class="od-modal-body">
        <textarea class="od-tex" spellcheck={false} value={html} onInput={(e) => setHtml((e.target as HTMLTextAreaElement).value)} />
        {error && <p class="od-note od-note-error"><Icon name="warning" size={16} />{error}</p>}
        <footer class="od-modal-foot">
          <button class="od-btn" onClick={onClose}>Cancel</button>
          <button class="od-btn primary" onClick={apply}>Apply</button>
        </footer>
      </div>
    </Modal>
  );
}
