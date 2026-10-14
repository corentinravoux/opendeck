// Edit the HTML of the current slide directly (Alt+Shift+H), as in slides.com.
import { useState } from "preact/hooks";
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
    <div class="od-modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="od-modal od-html" role="dialog" aria-label="Slide HTML">
        <h2>HTML of slide {editor.current.value + 1}</h2>
        <textarea class="od-tex" spellcheck={false} value={html} onInput={(e) => setHtml((e.target as HTMLTextAreaElement).value)} />
        {error && <p class="od-error">{error}</p>}
        <footer>
          <button onClick={onClose}>Cancel</button>
          <button class="primary" onClick={apply}>Apply</button>
        </footer>
      </div>
    </div>
  );
}
