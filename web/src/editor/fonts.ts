// Fonts offered for text, all bundled with the deck runtime (so exports render offline).
export const FONTS: { label: string; css: string }[] = [
  { label: "Open Sans", css: '"Open Sans", sans-serif' },
  { label: "Montserrat", css: "Montserrat, Helvetica, sans-serif" },
  { label: "Lato", css: "Lato, sans-serif" },
  { label: "Merriweather", css: "Merriweather, Georgia, serif" },
  { label: "Monospace", css: '"Courier New", Courier, monospace' },
];

export const BASIC_COLOURS = ["#000000", "#ffffff", "#434343", "#999999", "#cc0000", "#e69138", "#f1c232",
  "#6aa84f", "#45818e", "#3c78d8", "#1155cc", "#674ea7", "#a64d79"];

/** The colours a deck already uses in text, most frequent first (hex, lower case). */
export function deckColours(html: string, max = 8): string[] {
  const counts = new Map<string, number>();
  const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
  for (const m of html.matchAll(/color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}\b|rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\))/g)) {
    let c = m[1].toLowerCase();
    if (m[2]) c = hex(+m[2], +m[3], +m[4]);
    else if (c.length === 4) c = "#" + [...c.slice(1)].map((x) => x + x).join("");
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, max);
}
