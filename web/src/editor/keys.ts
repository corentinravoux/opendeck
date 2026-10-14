// Keyboard shortcuts of the editor (slides.com's layout, see the editor spec).
// Letters are matched on event.key, so they follow the keyboard layout (AZERTY included);
// the bracket shortcuts also have Ctrl(+Shift)+Arrow alternatives, since brackets need AltGr
// on AZERTY.
import { blocksOf, duplicateBlocks, findBlock, groupBlocks, moveBlock, removeBlocks, reorder, ungroupBlock, type ZMove } from "../model/ops";
import type { Editor } from "./store";

const typing = (e: KeyboardEvent) =>
  (e.target as HTMLElement).closest("input, textarea, [contenteditable=true], [contenteditable='']");

export function handleKey(editor: Editor, e: KeyboardEvent, slideCount: number): boolean {
  if (typing(e)) return false;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const sel = editor.selection.value;
  const cur = editor.current.value;
  const onSlide = (label: string, recipe: (s: Editor["slide"]) => void, mergeKey?: string) =>
    editor.edit(label, (doc) => { recipe(doc.slides[cur]); doc.slides[cur].dirty = true; }, mergeKey);

  if (ctrl && key === "z" && !e.shiftKey) { editor.undo(); return true; }
  if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) { editor.redo(); return true; }
  if (ctrl && key === "s") { void editor.save(true); return true; }
  if (ctrl && key === "a") { editor.selection.value = blocksOf(editor.slide.items).map((b) => b.id); return true; }
  if (!ctrl && (key === "+" || key === "=")) { editor.zoom.value = Math.min(4, editor.zoom.value * 1.25); return true; }
  if (!ctrl && key === "-") { editor.zoom.value = Math.max(0.25, editor.zoom.value / 1.25); return true; }
  if (!ctrl && key === "0") { editor.zoom.value = 1; return true; }
  if (key === "Escape") { editor.tool.value = null; editor.selection.value = []; return true; }
  if (!ctrl && !e.altKey && (key === "l" || key === "a" || key === "p") && !sel.length) {
    const tool = key === "l" ? "line" : key === "a" ? "arrow" : "pen";
    editor.tool.value = editor.tool.value === tool ? null : tool;
    return true;
  }

  if (sel.length) {
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (key in arrows && !ctrl) {
      const step = e.shiftKey ? 10 : 1;
      const [ax, ay] = arrows[key];
      onSlide("Nudge", (s) => sel.forEach((id) => moveBlock(findBlock(s, id)!, ax * step, ay * step)), "nudge");
      return true;
    }
    if (key === "Delete" || key === "Backspace") {
      onSlide("Delete", (s) => removeBlocks(s, sel));
      editor.selection.value = [];
      return true;
    }
    if (ctrl && key === "g" && !e.shiftKey && sel.length > 1) {
      let gid: string | null = null;
      onSlide("Group", (s) => { gid = groupBlocks(s, sel); });
      if (gid) editor.selection.value = [gid];
      return true;
    }
    if (ctrl && key === "g" && e.shiftKey) {
      let kids: string[] = [];
      onSlide("Ungroup", (s) => { kids = sel.flatMap((id) => ungroupBlock(s, id)); });
      if (kids.length) editor.selection.value = kids;
      return true;
    }
    if (ctrl && key === "d") {
      let made: string[] = [];
      onSlide("Duplicate", (s) => { made = duplicateBlocks(s, sel, 20, 20); });
      editor.selection.value = made;
      return true;
    }
    const z: ZMove | null =
      (ctrl && key === "]") || (ctrl && e.shiftKey && key === "ArrowUp") ? "front" :
      (ctrl && key === "[") || (ctrl && e.shiftKey && key === "ArrowDown") ? "back" :
      (!ctrl && key === "]") || (ctrl && key === "ArrowUp") ? "forward" :
      (!ctrl && key === "[") || (ctrl && key === "ArrowDown") ? "backward" : null;
    if (z) { onSlide("Arrange", (s) => reorder(s, sel, z)); return true; }
  } else {
    const nav: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, PageDown: 1, ArrowUp: -1, ArrowLeft: -1, PageUp: -1 };
    if (key in nav) { editor.flushText?.(); editor.current.value = Math.max(0, Math.min(slideCount - 1, cur + nav[key])); return true; }
    if (key === "Home") { editor.current.value = 0; return true; }
    if (key === "End") { editor.current.value = slideCount - 1; return true; }
  }
  return false;
}
