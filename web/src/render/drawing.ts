// Freehand strokes, stored like slides.com drawings: data-points (the pointer samples, slide
// coordinates) and an SVG whose filled path is the stroke outline.
import { getStroke } from "perfect-freehand";

const f = (n: number) => String(Math.round(n * 100) / 100);

export function strokeOutline(points: [number, number][], size: number): [number, number][] {
  return getStroke(points, { size, thinning: 0.5, smoothing: 0.5, streamline: 0.5, last: true }) as [number, number][];
}

/** Path data for a closed outline, using quadratic segments through midpoints. */
export function outlinePath(outline: [number, number][]): string {
  if (outline.length < 2) return "";
  const d = [`M ${f(outline[0][0])} ${f(outline[0][1])} Q`];
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d.push(`${f(x0)} ${f(y0)} ${f((x0 + x1) / 2)} ${f((y0 + y1) / 2)}`);
  }
  return d.join(" ") + " Z";
}

export interface Drawing { left: number; top: number; width: number; height: number; svg: string; points: string }

export function drawingFrom(points: [number, number][], colour: string, size: number): Drawing | null {
  const outline = strokeOutline(points, size);
  if (outline.length < 3) return null;
  const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  const width = Math.max(1, Math.max(...xs) - left), height = Math.max(1, Math.max(...ys) - top);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" preserveAspectRatio="none" width="100%" height="100%" `
    + `viewBox="${f(left)} ${f(top)} ${f(width)} ${f(height)}"><path fill="${colour}" d="${outlinePath(outline)}"></path></svg>`;
  return { left, top, width, height, svg, points: points.map(([x, y]) => `${f(x)} ${f(y)}`).join(",") };
}
