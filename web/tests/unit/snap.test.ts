// Alignment guides: which line snaps to which, within what distance, on both axes.
import { describe, expect, it } from "vitest";
import { snap, type Box } from "../../src/editor/snap";

const slide = { width: 1000, height: 600 };
const box = (left: number, top: number, width = 100, height = 50): Box => ({ left, top, width, height });
// a target far from the slide's own edges and centre lines, so only it can attract
const other = box(300, 300, 200, 100); // x lines 300 400 500, y lines 300 350 400

describe("snap", () => {
  it("leaves a box alone beyond the threshold", () => {
    const s = snap(box(130, 120), [other], slide, 6);
    expect(s).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("snaps left edge to left edge within the threshold, on x only", () => {
    const s = snap(box(304, 120, 80), [other], slide, 6); // x lines 304 344 384
    expect(s.dx).toBe(-4);
    expect(s.dy).toBe(0);
    expect(s.guides).toEqual([{ axis: "x", at: 300 }]);
  });

  it("uses the threshold inclusively, and not one unit more", () => {
    expect(snap(box(306, 120), [other], slide, 6).dx).toBe(-6);
    expect(snap(box(307, 120), [other], slide, 6).dx).toBe(0);
  });

  it("aligns centres", () => {
    const s = snap(box(353, 120), [other], slide, 6); // centre 403 -> 400; edges 53 and 47 away
    expect(s.dx).toBe(-3);
    expect(s.guides).toEqual([{ axis: "x", at: 400 }]);
  });

  it("aligns a right edge with a left edge", () => {
    const s = snap(box(198, 120), [other], slide, 6); // right edge 298 -> 300
    expect(s.dx).toBe(2);
    expect(s.guides).toEqual([{ axis: "x", at: 300 }]);
  });

  it("snaps both axes at once", () => {
    const s = snap(box(502, 395), [other], slide, 6); // left 502 -> 500, top 395 -> 400
    expect(s.dx).toBe(-2);
    expect(s.dy).toBe(5);
    expect(s.guides).toEqual([{ axis: "x", at: 500 }, { axis: "y", at: 400 }]);
  });

  it("picks the nearest candidate", () => {
    const moving = box(203, 120); // x lines 203 253 303
    expect(snap(moving, [other], slide, 6).dx).toBe(-3); // right edge 303 -> 300
    const closer = box(205, 0, 1, 1); // x lines 205 205.5 206
    const s = snap(moving, [other, closer], slide, 6); // left edge 203 -> 205 is nearer
    expect(s.dx).toBe(2);
    expect(s.guides).toEqual([{ axis: "x", at: 205 }]);
  });

  it("uses the slide's edges and centre lines", () => {
    expect(snap(box(3, 120), [], slide, 6).dx).toBe(-3); // left edge
    expect(snap(box(904, 120), [], slide, 6).dx).toBe(-4); // right edge 1004 -> 1000
    const c = snap(box(448, 272), [], slide, 6); // centre 498 -> 500, middle 297 -> 300
    expect(c.dx).toBe(2);
    expect(c.dy).toBe(3);
    expect(c.guides).toEqual([{ axis: "x", at: 500 }, { axis: "y", at: 300 }]);
  });

  it("draws a guide for every line the snapped box lies on", () => {
    // same width as `other`: snapping its left edge aligns centre and right edge too
    const s = snap(box(302, 120, 200, 50), [other], slide, 6);
    expect(s.dx).toBe(-2);
    expect(s.guides.map((g) => g.at)).toEqual([300, 400, 500]);
  });

  it("snaps only the given lines (resizing)", () => {
    // dragging the right edge: the left edge at 302 must not snap to 300
    const r = snap(box(302, 120, 195, 50), [other], slide, 6, { x: [2], y: [] }); // right 497 -> 500
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(0);
    const none = snap(box(302, 120, 150, 50), [other], slide, 6, { x: [2], y: [] }); // right 452: nothing
    expect(none.dx).toBe(0);
  });

  it("works with a threshold in slide units derived from the zoom", () => {
    const scale = 0.5; // the slide is shown at half size: 6 screen px are 12 slide px
    expect(snap(box(310, 120), [other], slide, 6 / scale).dx).toBe(-10);
    expect(snap(box(310, 120), [other], slide, 6 / 2).dx).toBe(0);
  });
});
