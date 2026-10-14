// Snapping of a moving box to the slide edges and centre lines, and to other blocks.
export interface Box { left: number; top: number; width: number; height: number }
export interface Guide { axis: "x" | "y"; at: number }

const lines = (b: Box) => ({
  x: [b.left, b.left + b.width / 2, b.left + b.width],
  y: [b.top, b.top + b.height / 2, b.top + b.height],
});

/** Best (dx, dy) correction within `threshold` slide px, and the guides to draw. */
export function snap(moving: Box, others: Box[], slide: { width: number; height: number }, threshold: number):
  { dx: number; dy: number; guides: Guide[] } {
  const targets = {
    x: [0, slide.width / 2, slide.width, ...others.flatMap((o) => lines(o).x)],
    y: [0, slide.height / 2, slide.height, ...others.flatMap((o) => lines(o).y)],
  };
  const mine = lines(moving);
  const best = (axis: "x" | "y") => {
    let delta = 0, dist = threshold + 1, at = 0;
    for (const m of mine[axis]) for (const t of targets[axis]) {
      const d = Math.abs(t - m);
      if (d < dist) { dist = d; delta = t - m; at = t; }
    }
    return dist <= threshold ? { delta, at } : null;
  };
  const bx = best("x"), by = best("y");
  const guides: Guide[] = [];
  if (bx) guides.push({ axis: "x", at: bx.at });
  if (by) guides.push({ axis: "y", at: by.at });
  return { dx: bx?.delta ?? 0, dy: by?.delta ?? 0, guides };
}
