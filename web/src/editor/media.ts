// Images dropped or pasted onto the canvas: upload each into the deck's media/ folder first,
// then insert an image block (so a saved deck never points at a missing file).
import { imageBlock } from "../model/factory";
import type { Editor } from "./store";

export async function upload(deck: string, file: Blob, name: string):
  Promise<{ src: string; width: number | null; height: number | null }> {
  const r = await fetch(`/api/decks/${encodeURIComponent(deck)}/media`, {
    method: "POST",
    headers: { "X-Opendeck": "1", "Content-Type": file.type || "application/octet-stream", "X-Filename": encodeURIComponent(name) },
    body: file,
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? r.statusText);
  return body;
}

/** Insert images at slide point (x, y), each fitted to at most 80 % of the slide, cascading by 20 px. */
export async function insertImages(editor: Editor, files: File[], x: number, y: number): Promise<void> {
  const { width: W, height: H } = editor.deck.meta;
  const made: string[] = [];
  let k = 0;
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    let up;
    try {
      up = await upload(editor.name, file, file.name || "pasted.png");
    } catch (err) {
      editor.message.value = `${file.name || "image"}: ${(err as Error).message}`;
      continue;
    }
    const nw = up.width ?? 400, nh = up.height ?? 300;
    const fit = Math.min(1, (0.8 * W) / nw, (0.8 * H) / nh);
    const w = nw * fit, h = nh * fit;
    const left = Math.max(0, Math.min(W - w, x - w / 2 + 20 * k));
    const top = Math.max(0, Math.min(H - h, y - h / 2 + 20 * k));
    editor.edit("Insert image", (doc) => {
      const s = doc.slides[editor.current.value];
      const b = imageBlock(s, up.src, left, top, w, h, up);
      s.items.push({ kind: "block", block: b });
      s.dirty = true;
      made.push(b.id);
    });
    k++;
  }
  if (made.length) editor.selection.value = made;
}

/** Files carried by a drop or a paste (clipboard images included). */
export function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromItems = [...data.items].filter((i) => i.kind === "file" && i.type.startsWith("image/"))
    .map((i) => i.getAsFile()).filter((f): f is File => !!f);
  return fromItems.length ? fromItems : [...data.files].filter((f) => f.type.startsWith("image/"));
}
