// Doc -> slides HTML. Untouched slides are written back from their source text; edited
// slides (dirty) are rebuilt from the model.
import type { Block, Doc, Item, Shell, Slide } from "./types";

function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/ /g, "&nbsp;");
}

export function open(shell: Shell): string {
  return `<${shell.tag}${shell.attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("")}>`;
}

function items(list: Item[]): string {
  return list.map((it) => (it.kind === "raw" ? it.html : blockHtml(it.block))).join("");
}

export function blockHtml(b: Block): string {
  const body = b.children ? items(b.children) : b.inner;
  const content = `${open(b.content)}${body}</${b.content.tag}>`;
  const styled = b.wrapper ? `${open(b.wrapper)}${content}</${b.wrapper.tag}>` : content;
  return `${open(b.outer)}${styled}${b.extras}</${b.outer.tag}>`;
}

export function slideHtml(s: Slide): string {
  if (!s.dirty) return s.source;
  return `<section${s.attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("")}>${items(s.items)}</section>`;
}

export function serializeDoc(doc: Doc): string {
  return doc.slides.map((s) => s.before + slideHtml(s)).join("") + doc.tail;
}
