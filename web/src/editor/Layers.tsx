// Layers panel (Ctrl+O): the blocks of the current slide, topmost first.
import { blocksOf, reorder, zIndex } from "../model/ops";
import type { Block } from "../model/types";
import type { Editor } from "./store";
import { Icon, type IconName } from "../app/icons";

const ICON: Record<string, IconName> = { text: "text", math: "sigma", image: "image", shape: "shape", line: "line", drawing: "pen", group: "group" };

function summary(b: Block): string {
  const name = b.outer.attrs.find(([k]) => k === "data-name")?.[1] ?? b.type;
  const tpl = document.createElement("template");
  tpl.innerHTML = b.inner;
  const text = (b.type === "math" ? tpl.content.querySelector(".math-input")?.textContent : tpl.content.textContent) ?? "";
  return text.trim() ? text.trim().slice(0, 60) : name;
}

export function Layers({ editor }: { editor: Editor }) {
  const slide = editor.slide;
  if (!slide) return null;
  const blocks = blocksOf(slide.items).sort((a, b) => zIndex(b) - zIndex(a));
  const sel = editor.selection.value;
  const move = (id: string, dir: "forward" | "backward") =>
    editor.edit("Arrange", (doc) => { reorder(doc.slides[editor.current.value], [id], dir); });
  return (
    <aside class="od-layers">
      <h3>Layers</h3>
      {blocks.map((b) => (
        <div key={b.id} class={`od-layer${sel.includes(b.id) ? " on" : ""}`}
          onClick={(e) => (editor.selection.value = e.shiftKey ? [...sel, b.id] : [b.id])}>
          <span class="od-layer-icon"><Icon name={ICON[b.type] ?? "shape"} size={16} /></span>
          <span class="od-layer-name" title={summary(b)}>{summary(b)}</span>
          <button title="Bring forward" aria-label="Bring forward" onClick={(e) => { e.stopPropagation(); move(b.id, "forward"); }}><Icon name="up" size={16} /></button>
          <button title="Send backward" aria-label="Send backward" onClick={(e) => { e.stopPropagation(); move(b.id, "backward"); }}><Icon name="down" size={16} /></button>
        </div>
      ))}
    </aside>
  );
}
