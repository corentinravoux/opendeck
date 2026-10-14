// Slides HTML (the region between the od:slides markers) -> Doc.
// Top-level sections are cut out of the string as is, so a slide that is never edited is
// written back byte for byte. Each section is then parsed with the DOM into blocks.
import type { Block, Doc, Item, Pair, Shell, Slide } from "./types";

/** Split HTML into its top-level <section> elements, keeping the whitespace between them. */
export function splitSections(html: string): { sections: { source: string; before: string }[]; tail: string } {
  const re = /<\/?section\b[^>]*>/gi;
  const sections: { source: string; before: string }[] = [];
  let depth = 0, start = -1, last = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const closing = m[0][1] === "/";
    if (!closing) {
      if (depth === 0) start = m.index;
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) {
        const end = m.index + m[0].length;
        sections.push({ source: html.slice(start, end), before: html.slice(last, start) });
        last = end;
      }
    }
  }
  return { sections, tail: html.slice(last) };
}

function shell(el: Element): Shell {
  return { tag: el.tagName.toLowerCase(), attrs: [...el.attributes].map((a) => [a.name, a.value] as Pair) };
}

function isBlock(node: Node): node is Element {
  return node.nodeType === 1 && (node as Element).classList.contains("sl-block");
}

function rawOf(node: Node): string {
  if (node.nodeType === 1) return (node as Element).outerHTML;
  if (node.nodeType === 3) return escapeText(node.textContent ?? "");
  if (node.nodeType === 8) return `<!--${(node as Comment).data}-->`;
  return "";
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;");
}

function items(nodes: NodeListOf<ChildNode> | ChildNode[]): Item[] {
  const out: Item[] = [];
  for (const node of nodes) {
    if (isBlock(node)) out.push({ kind: "block", block: parseBlock(node) });
    else {
      const html = rawOf(node);
      if (html) out.push({ kind: "raw", html });
    }
  }
  return out;
}

export function parseBlock(el: Element): Block {
  let wrapper: Shell | null = null;
  let contentEl: Element | null = null;
  let extras = "";
  for (const child of el.childNodes) {
    if (child.nodeType === 1 && (child as Element).classList.contains("sl-block-style") && !contentEl) {
      wrapper = shell(child as Element);
      contentEl = (child as Element).querySelector(":scope > .sl-block-content");
    } else if (child.nodeType === 1 && (child as Element).classList.contains("sl-block-content") && !contentEl) {
      contentEl = child as Element;
    } else if (contentEl) {
      extras += rawOf(child);
    }
  }
  if (!contentEl) throw new Error(`block ${el.getAttribute("data-block-id")} has no .sl-block-content`);
  const type = el.getAttribute("data-block-type") ?? "";
  const group = type === "group";
  return {
    id: el.getAttribute("data-block-id") ?? "",
    type,
    outer: shell(el),
    wrapper,
    content: shell(contentEl),
    inner: group ? "" : contentEl.innerHTML,
    children: group ? items(contentEl.childNodes) : null,
    extras,
  };
}

export function parseSection(source: string, before = ""): Slide {
  const tpl = document.createElement("template");
  tpl.innerHTML = source;
  const el = tpl.content.querySelector("section");
  if (!el) throw new Error("not a <section>");
  return {
    id: el.getAttribute("data-id") ?? "",
    attrs: [...el.attributes].map((a) => [a.name, a.value] as Pair),
    items: items(el.childNodes),
    source,
    dirty: false,
    before,
  };
}

export function parseDoc(html: string): Doc {
  const { sections, tail } = splitSections(html);
  return { slides: sections.map((s) => parseSection(s.source, s.before)), tail };
}
