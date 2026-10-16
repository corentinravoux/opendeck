// Images and videos dropped or pasted onto the canvas: upload each into the deck's media/ folder
// first, then insert an image or video block (so a saved deck never points at a missing file).
import { imageBlock, videoBlock } from "../model/factory";
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

const isVideo = (f: File) => f.type.startsWith("video/") || /\.(webm|mp4|m4v|mov)$/i.test(f.name);
const isMedia = (f: File) => f.type.startsWith("image/") || isVideo(f);

/** Pixel size of a video file, read by the browser (the server does not decode video). */
function videoSize(file: Blob): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (width: number | null, height: number | null) => { URL.revokeObjectURL(url); resolve({ width, height }); };
    v.preload = "metadata";
    v.onloadedmetadata = () => done(v.videoWidth || null, v.videoHeight || null);
    v.onerror = () => done(null, null);
    v.src = url;
  });
}

/**
 * Insert images and videos. Images go at slide point (x, y), fitted to at most 80 % of the slide,
 * cascading by 20 px; a video fills as much of the slide as its aspect allows, centred.
 */
export async function insertMedia(editor: Editor, files: File[], x: number, y: number): Promise<void> {
  const { width: W, height: H } = editor.deck.meta;
  const made: string[] = [];
  let k = 0;
  for (const file of files) {
    if (!isMedia(file)) continue;
    const video = isVideo(file);
    let up;
    try {
      up = await upload(editor.name, file, file.name || "pasted.png");
      if (video) up = { ...up, ...(await videoSize(file)) };
    } catch (err) {
      editor.message.value = `${file.name || "image"}: ${(err as Error).message}`;
      continue;
    }
    const nw = up.width ?? (video ? W : 400), nh = up.height ?? (video ? H : 300);
    const fit = video ? Math.min(W / nw, H / nh) : Math.min(1, (0.8 * W) / nw, (0.8 * H) / nh);
    const w = nw * fit, h = nh * fit;
    const left = video ? (W - w) / 2 : Math.max(0, Math.min(W - w, x - w / 2 + 20 * k));
    const top = video ? (H - h) / 2 : Math.max(0, Math.min(H - h, y - h / 2 + 20 * k));
    const src = up.src;
    editor.edit(video ? "Insert video" : "Insert image", (doc) => {
      const s = doc.slides[editor.current.value];
      const b = video ? videoBlock(s, src, left, top, w, h) : imageBlock(s, src, left, top, w, h, up);
      s.items.push({ kind: "block", block: b });
      s.dirty = true;
      made.push(b.id);
    });
    if (!video) k++;
  }
  if (made.length) editor.selection.value = made;
}

/** Image and video files carried by a drop or a paste (clipboard images included). */
export function mediaFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromItems = [...data.items].filter((i) => i.kind === "file").map((i) => i.getAsFile())
    .filter((f): f is File => !!f && isMedia(f));
  return fromItems.length ? fromItems : [...data.files].filter(isMedia);
}

/** Ask for one file with the system picker; resolves to null when cancelled. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
