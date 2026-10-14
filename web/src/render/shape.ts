// SVG of a shape block, regenerated from its data-shape-* attributes, in the form slides.com
// decks use: viewBox = the block size, preserveAspectRatio="none", one element with class
// "shape-element". A border is an inner stroke: drawn at twice its width and clipped to the shape.
// symbol-* shapes (icons) are not generated here; their stored path is user data.

export interface ShapeSpec {
  type: string;          // rect | circle | diamond | octagon | triangle-up/down/left/right | arrow-up/down/left/right
  width: number;
  height: number;
  fill: string;
  stroke: string | null;
  strokeWidth: number;   // px
  radius: number;        // corner radius (rect)
}

export const SHAPES: [string, string][] = [
  ["rect", "Rectangle"], ["circle", "Ellipse"], ["diamond", "Diamond"], ["octagon", "Octagon"],
  ["triangle-up", "Triangle"], ["triangle-down", "Triangle, pointing down"],
  ["arrow-right", "Arrow right"], ["arrow-left", "Arrow left"], ["arrow-up", "Arrow up"], ["arrow-down", "Arrow down"],
];

const f = (n: number) => String(Math.round(n * 1000) / 1000);
const pts = (p: [number, number][]) => p.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");

function element(s: ShapeSpec, extra: string): string {
  const { width: w, height: h } = s;
  switch (s.type) {
    case "rect":
      return `<rect width="${f(w)}" height="${f(h)}" rx="${f(s.radius)}" ry="${f(s.radius)}"${extra}></rect>`;
    case "circle":
      return `<ellipse rx="${f(w / 2)}" ry="${f(h / 2)}" cx="${f(w / 2)}" cy="${f(h / 2)}"${extra}></ellipse>`;
  }
  const poly: Record<string, [number, number][]> = {
    "diamond": [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]],
    "octagon": [[0.3 * w, 0], [0.7 * w, 0], [w, 0.3 * h], [w, 0.7 * h], [0.7 * w, h], [0.3 * w, h], [0, 0.7 * h], [0, 0.3 * h]],
    "triangle-up": [[w / 2, 0], [w, h], [0, h]],
    "triangle-down": [[0, 0], [w, 0], [w / 2, h]],
    "triangle-left": [[w, 0], [w, h], [0, h / 2]],
    "triangle-right": [[0, 0], [w, h / 2], [0, h]],
    // proportions as in real decks: shaft 40 % thick, head half the length
    "arrow-up": [[w / 2, 0], [w, h / 2], [0.7 * w, h / 2], [0.7 * w, h], [0.3 * w, h], [0.3 * w, h / 2], [0, h / 2], [w / 2, 0]],
    "arrow-down": [[0.3 * w, 0], [0.7 * w, 0], [0.7 * w, h / 2], [w, h / 2], [w / 2, h], [0, h / 2], [0.3 * w, h / 2]],
    "arrow-right": [[0, 0.3 * h], [w / 2, 0.3 * h], [w / 2, 0], [w, h / 2], [w / 2, h], [w / 2, 0.7 * h], [0, 0.7 * h]],
    "arrow-left": [[w, 0.3 * h], [w / 2, 0.3 * h], [w / 2, 0], [0, h / 2], [w / 2, h], [w / 2, 0.7 * h], [w, 0.7 * h]],
  };
  return `<polygon points="${pts(poly[s.type] ?? poly["diamond"])}"${extra}></polygon>`;
}

/** `clipId` must be unique in the page (the block id is used). */
export function shapeSvg(s: ShapeSpec, clipId: string): string {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 ${f(s.width)} ${f(s.height)}">`;
  if (!s.stroke || s.strokeWidth <= 0) {
    return `${head}${element(s, ` class="shape-element" fill="${s.fill}"`)}</svg>`;
  }
  const paint = ` fill="${s.fill}" stroke="${s.stroke}" stroke-width="${f(2 * s.strokeWidth)}"`;
  return `${head}<defs><clipPath id="${clipId}">${element(s, paint)}</clipPath></defs>`
    + `${element(s, ` class="shape-element"${paint} clip-path="url(#${clipId})"`)}</svg>`;
}
