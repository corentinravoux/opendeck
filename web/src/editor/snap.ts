// Snapping of a moving box to the slide edges and centre lines, and to other blocks' edges and
// centres. Pure: Canvas.tsx feeds it boxes in slide px and draws the guides it returns.
export interface Box { left: number; top: number; width: number; height: number }
export interface Guide { axis: "x" | "y"; at: number }
/** Lines of a box on one axis: 0 = left / top edge, 1 = centre / middle, 2 = right / bottom edge. */
export type Line = 0 | 1 | 2;
const ALL: Line[] = [0, 1, 2];

const lines = (b: Box) => ({
  x: [b.left, b.left + b.width / 2, b.left + b.width],
  y: [b.top, b.top + b.height / 2, b.top + b.height],
});

/** Best (dx, dy) correction within `threshold` slide px, and the guides to draw. On each axis the
 *  nearest pair (a line of `moving`, a target line) wins. `which` restricts which lines of `moving`
 *  may snap: all three when moving a block, only the dragged edge when resizing one. A guide is
 *  returned for every target line that a snapping line of `moving` then lies on. */
export function snap(moving: Box, others: Box[], slide: { width: number; height: number }, threshold: number,
  which: { x: Line[]; y: Line[] } = { x: ALL, y: ALL }): { dx: number; dy: number; guides: Guide[] } {
  const targets = {
    x: [0, slide.width / 2, slide.width, ...others.flatMap((o) => lines(o).x)],
    y: [0, slide.height / 2, slide.height, ...others.flatMap((o) => lines(o).y)],
  };
  const own = lines(moving);
  const mine = { x: which.x.map((i) => own.x[i]), y: which.y.map((i) => own.y[i]) };
  const best = (axis: "x" | "y") => {
    let delta = 0, dist = Infinity;
    for (const m of mine[axis]) for (const t of targets[axis]) {
      const d = Math.abs(t - m);
      if (d < dist) { dist = d; delta = t - m; }
    }
    return dist <= threshold ? { delta } : null;
  };
  const along = (axis: "x" | "y", delta: number): Guide[] => {
    const at = new Set<number>();
    for (const m of mine[axis]) for (const t of targets[axis]) if (Math.abs(t - (m + delta)) < 0.01) at.add(t);
    return [...at].sort((a, b) => a - b).map((v) => ({ axis, at: v }));
  };
  const bx = best("x"), by = best("y");
  const guides = [...(bx ? along("x", bx.delta) : []), ...(by ? along("y", by.delta) : [])];
  return { dx: bx?.delta ?? 0, dy: by?.delta ?? 0, guides };
}
