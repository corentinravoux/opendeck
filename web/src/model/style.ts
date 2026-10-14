// Ordered, lossless access to style="" strings and attribute lists.
import type { Pair, Shell } from "./types";

/** "left: 10px; top: 2px;" -> [["left","10px"],["top","2px"]] (order kept, values trimmed). */
export function parseStyle(style: string): Pair[] {
  const out: Pair[] = [];
  let depth = 0, quote = "", start = 0;
  const push = (chunk: string) => {
    const i = chunk.indexOf(":");
    if (i > 0) out.push([chunk.slice(0, i).trim().toLowerCase(), chunk.slice(i + 1).trim()]);
  };
  for (let i = 0; i < style.length; i++) {
    const c = style[i];
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) { push(style.slice(start, i)); start = i + 1; }
  }
  push(style.slice(start));
  return out;
}

export function formatStyle(pairs: Pair[]): string {
  return pairs.map(([k, v]) => `${k}: ${v};`).join(" ");
}

export function getAttr(shell: Shell, name: string): string | null {
  const hit = shell.attrs.find(([k]) => k === name);
  return hit ? hit[1] : null;
}

export function setAttr(shell: Shell, name: string, value: string | null): void {
  const i = shell.attrs.findIndex(([k]) => k === name);
  if (value === null) { if (i >= 0) shell.attrs.splice(i, 1); }
  else if (i >= 0) shell.attrs[i] = [name, value];
  else shell.attrs.push([name, value]);
}

export function getStyle(shell: Shell, prop: string): string | null {
  const hit = parseStyle(getAttr(shell, "style") ?? "").find(([k]) => k === prop);
  return hit ? hit[1] : null;
}

/** Set (or remove, with null) one declaration, keeping the others in place. */
export function setStyle(shell: Shell, prop: string, value: string | null): void {
  const pairs = parseStyle(getAttr(shell, "style") ?? "");
  const i = pairs.findIndex(([k]) => k === prop);
  if (value === null) { if (i >= 0) pairs.splice(i, 1); }
  else if (i >= 0) pairs[i] = [prop, value];
  else pairs.push([prop, value]);
  setAttr(shell, "style", pairs.length ? formatStyle(pairs) : null);
}

export function hasClass(shell: Shell, cls: string): boolean {
  return (getAttr(shell, "class") ?? "").split(/\s+/).includes(cls);
}

export function setClass(shell: Shell, cls: string, on: boolean): void {
  const list = (getAttr(shell, "class") ?? "").split(/\s+/).filter(Boolean);
  const next = on ? (list.includes(cls) ? list : [...list, cls]) : list.filter((c) => c !== cls);
  setAttr(shell, "class", next.length ? next.join(" ") : null);
}
