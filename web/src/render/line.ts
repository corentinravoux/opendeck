// SVG of a line/arrow block, regenerated from its data-line-* attributes. The geometry
// reproduces the lines in real slides.com decks (measured over 3152 of them):
//   - the visible stroke stops `w` short of a "line-arrow" end, 2.5·w short of an "arrow" end;
//   - "line-arrow" heads are two strokes at ±45°, each spanning max(6, 2.25·w) px per axis, with
//     the tip set back max(0.75, 0.5·w − 0.75) (rounded style) or max(1, 0.75·w − 1) (plain);
//   - "arrow" heads are filled triangles, tip on the end point, wings 4·w back and ±2·w across;
//   - data-line-c is the sagitta of a circular arc (0 = straight); on an arc, a head points along the tangent 1.5·w back from its end
//     and the stroke is shortened along the tangent 0.5·w back (the redrawn arc's radius
//     differs from slides.com's by < 0.2 px of curve).

export interface LineSpec {
  x1: number; y1: number; x2: number; y2: number;
  color: string; width: number;
  start: string; end: string;   // none | line-arrow | arrow
  style: string | null;         // solid-rounded | dashed | solid | null (plain)
  c: number;                    // sagitta, 0 for a straight line
}

const f = (n: number) => String(Math.round(n * 1000) / 1000);

type P = [number, number];

/** Point at each end, and the unit direction an arrow head there points to (away from the line).
 *  On an arc, slides.com aims the head along the tangent 1.5·w back from the end, not at the end. */
function ends(s: LineSpec): { a: P; ta: P; b: P; tb: P; sa: P; sb: P; arc: { r: number; sweep: number } | null } {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const L = Math.hypot(dx, dy) || 1;
  const u: P = [dx / L, dy / L];
  if (!s.c) return { a: [s.x1, s.y1], ta: [-u[0], -u[1]], b: [s.x2, s.y2], tb: u, sa: [-u[0], -u[1]], sb: u, arc: null };
  const sag = Math.abs(s.c);
  const r = (sag * sag + (L / 2) * (L / 2)) / (2 * sag);
  const side = s.c > 0 ? 1 : -1;
  const n: P = [-u[1] * side, u[0] * side];
  const mid: P = [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2];
  const ctr: P = [mid[0] - n[0] * (r - sag), mid[1] - n[1] * (r - sag)];
  const angle = (p: P) => Math.atan2(p[1] - ctr[1], p[0] - ctr[0]);
  const a1 = angle([s.x1, s.y1]), a2 = angle([s.x2, s.y2]);
  const travel = Math.sign(((a2 - a1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) || 1; // +1: angle grows from start to end
  const head = 1.5 * s.width / r, stroke = 0.5 * s.width / r; // arc lengths back from the end, as angles
  const dir = (a: number, sign: number): P => [-Math.sin(a) * sign, Math.cos(a) * sign];
  return {
    a: [s.x1, s.y1], ta: dir(a1 + travel * head, -travel), sa: dir(a1 + travel * stroke, -travel),
    b: [s.x2, s.y2], tb: dir(a2 - travel * head, travel), sb: dir(a2 - travel * stroke, travel),
    arc: { r, sweep: s.c > 0 ? 0 : 1 },
  };
}

function shortenBy(cap: string, w: number): number {
  return cap === "line-arrow" ? w : cap === "arrow" ? 2.5 * w : 0;
}

function head(cap: string, p: P, t: P, w: number, rounded: boolean, color: string, cls: string, side: 1 | -1): string {
  if (cap === "none") return "";
  const back = (d: number): P => [p[0] - t[0] * d, p[1] - t[1] * d];
  const perp: P = [-t[1] * side, t[0] * side]; // slides.com writes the start and end wings in opposite order
  if (cap === "line-arrow") {
    const k = Math.max(6, 2.25 * w);
    const tip = back(rounded ? Math.max(0.75, 0.5 * w - 0.75) : Math.max(1, 0.75 * w - 1));
    const w1: P = [tip[0] - t[0] * k + perp[0] * k, tip[1] - t[1] * k + perp[1] * k];
    const w2: P = [tip[0] - t[0] * k - perp[0] * k, tip[1] - t[1] * k - perp[1] * k];
    const d = `M ${f(w1[0])} ${f(w1[1])} L ${f(tip[0])} ${f(tip[1])} L ${f(w2[0])} ${f(w2[1])} L ${f(tip[0])} ${f(tip[1])}`;
    const round = rounded ? ' stroke-linecap="round" stroke-linejoin="round"' : "";
    return `<path stroke="${color}" stroke-width="${f(w)}" d="${d}"${round} class="${cls}"></path>`;
  }
  // filled triangle
  const a = 4 * w, b = 2 * w;
  const w1: P = [p[0] - t[0] * a + perp[0] * b, p[1] - t[1] * a + perp[1] * b];
  const w2: P = [p[0] - t[0] * a - perp[0] * b, p[1] - t[1] * a - perp[1] * b];
  const d = `M ${f(w1[0])} ${f(w1[1])} L ${f(p[0])} ${f(p[1])} L ${f(w2[0])} ${f(w2[1])}`;
  return `<path fill="${color}" d="${d}" stroke-linecap="round" stroke-linejoin="round" class="${cls}"></path>`;
}

export function lineSvg(s: LineSpec): string {
  const w = s.width;
  const rounded = s.style === "solid-rounded";
  const e = ends(s);
  const sa = shortenBy(s.start, w), sb = shortenBy(s.end, w);
  const A: P = [e.a[0] - e.sa[0] * sa, e.a[1] - e.sa[1] * sa];
  const B: P = [e.b[0] - e.sb[0] * sb, e.b[1] - e.sb[1] * sb];
  const shape = (p: P, q: P) => e.arc
    ? `M${f(p[0])} ${f(p[1])} A${f(e.arc.r)} ${f(e.arc.r)} 0 0 ${e.arc.sweep} ${f(q[0])} ${f(q[1])}`
    : `M${f(p[0])} ${f(p[1])} L${f(q[0])} ${f(q[1])}`;
  const full = shape([s.x1, s.y1], [s.x2, s.y2]);
  const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  let dash = "";
  if (s.style === "dashed") {
    const n = Math.max(1, Math.round((L / (3 * w) - 1) / 2) * 2 + 1);
    dash = ` stroke-dasharray="${f(L / n)} ${f(L / n)}"`;
  }
  const cap = rounded ? ' stroke-linecap="round"' : "";
  const W = Math.max(1, Math.max(s.x1, s.x2)), H = Math.max(1, Math.max(s.y1, s.y2));
  return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" preserveAspectRatio="xMidYMid" width="${f(W)}" height="${f(H)}" viewBox="0 0 ${f(W)} ${f(H)}">`
    + `<path class="line-element" fill="rgba(0,0,0,0)" stroke="${s.color}" stroke-width="${f(w)}"${cap}${dash} d="${shape(A, B)}"></path>`
    + head(s.start, e.a, e.ta, w, rounded, s.color, "line-start", 1)
    + head(s.end, e.b, e.tb, w, rounded, s.color, "line-end", -1)
    + `<path class="line-skeleton" fill="rgba(0,0,0,0)" stroke="rgba(0,0,0,0)" d="${full}"></path>`
    + `<path class="line-hitarea" fill="rgba(0,0,0,0)" stroke="rgba(0,0,0,0)" stroke-width="15" d="${full}"></path></svg>`;
}
