import { describe, expect, it } from "vitest";
import { applyPatches, enablePatches, produceWithPatches } from "immer";
import { blocksOf, duplicateBlocks, findBlock, frame, moveBlock, removeBlocks, reorder, rotation, setFrame, setRotation, zIndex } from "../../src/model/ops";
import { parseDoc } from "../../src/model/parse";
import { serializeDoc } from "../../src/model/serialize";
import type { Doc } from "../../src/model/types";

enablePatches();

const HTML = `<section data-id="s1"><div class="sl-block" data-block-type="text" style="height: auto; width: 600px; left: 40px; top: 40px;" data-block-id="a"><div class="sl-block-content" style="z-index: 10;"><p>A</p></div></div><div class="sl-block" data-block-type="shape" style="width: 100px; height: 50px; left: 10px; top: 20px;" data-block-id="b"><div class="sl-block-style" style="z-index: 11; transform: rotate(5deg);"><div class="sl-block-content" style="z-index: 11;"><svg></svg></div></div></div><div class="sl-block" data-block-type="group" data-block-id="g"><div class="sl-block-content sl-block-group-content" style="z-index: 12;"><div class="sl-block" data-block-type="text" style="left: 300px; top: 300px; width: 50px; height: auto;" data-block-id="c"><div class="sl-block-content" style="z-index: 13;">C</div></div></div></div></section>`;

const slide = (doc: Doc) => doc.slides[0];

describe("ops", () => {
  it("moves a block and a group's children", () => {
    const doc = parseDoc(HTML);
    moveBlock(findBlock(slide(doc), "a")!, 5, -2.5);
    moveBlock(findBlock(slide(doc), "g")!, 10, 10);
    expect(frame(findBlock(slide(doc), "a")!)).toMatchObject({ left: 45, top: 37.5, width: 600, height: null });
    expect(frame(findBlock(slide(doc), "c")!)).toMatchObject({ left: 310, top: 310 });
  });

  it("resizes without touching an auto height", () => {
    const doc = parseDoc(HTML);
    const a = findBlock(slide(doc), "a")!;
    setFrame(a, { width: 300, height: null });
    expect(a.outer.attrs.find(([k]) => k === "style")![1]).toBe("height: auto; width: 300px; left: 40px; top: 40px;");
  });

  it("reorders z-index densely and keeps the wrapper in step", () => {
    const doc = parseDoc(HTML);
    reorder(slide(doc), ["a"], "front");
    const z = Object.fromEntries(blocksOf(slide(doc).items).map((b) => [b.id, zIndex(b)]));
    expect(z).toEqual({ b: 10, g: 11, a: 12 });
    const b = findBlock(slide(doc), "b")!;
    expect(b.wrapper!.attrs.find(([k]) => k === "style")![1]).toContain("z-index: 10;");
    reorder(slide(doc), ["a"], "backward");
    expect(zIndex(findBlock(slide(doc), "a")!)).toBe(11);
  });

  it("duplicates with fresh ids, on top", () => {
    const doc = parseDoc(HTML);
    const [id] = duplicateBlocks(slide(doc), ["g"], 20, 20);
    const copy = findBlock(slide(doc), id)!;
    expect(id).not.toBe("g");
    expect(copy.outer.attrs.find(([k]) => k === "data-block-id")![1]).toBe(id);
    const child = blocksOf(copy.children!)[0];
    expect(child.id).not.toBe("c");
    expect(frame(child)).toMatchObject({ left: 320, top: 320 });
    expect(zIndex(copy)).toBe(13);
  });

  it("removes blocks; undo restores the exact HTML", () => {
    const doc = parseDoc(HTML);
    const [next, , inverse] = produceWithPatches(doc, (d) => removeBlocks(slide(d), ["b", "g"]));
    expect(serializeDoc(next)).not.toContain('data-block-id="b"');
    const back = applyPatches(next, inverse);
    expect(serializeDoc(back)).toBe(HTML);
  });
});

describe("ops inside Immer", () => {
  it("duplicates from a draft", () => {
    const doc = parseDoc(HTML);
    let made: string[] = [];
    const [next] = produceWithPatches(doc, (d) => { made = duplicateBlocks(slide(d), ["a"], 10, 10); });
    expect(made).toHaveLength(1);
    expect(findBlock(slide(next), made[0])).toBeTruthy();
  });
});

describe("rotation", () => {
  it("adds a wrapper when needed and edits an existing one", () => {
    const doc = parseDoc(HTML);
    const a = findBlock(slide(doc), "a")!;
    setRotation(a, 15);
    expect(rotation(a)).toBe(15);
    expect(serializeDoc({ ...doc, slides: [{ ...slide(doc), dirty: true }] }))
      .toContain('<div class="sl-block-style" style="z-index: 10; transform: rotate(15deg);"><div class="sl-block-content"');
    const b = findBlock(slide(doc), "b")!;
    setRotation(b, -30);
    expect(b.wrapper!.attrs.find(([k]) => k === "style")![1]).toBe("z-index: 11; transform: rotate(-30deg);");
  });
});

describe("slides", () => {
  it("adds, duplicates, moves and removes slides", async () => {
    const { addSlide, duplicateSlide, moveSlide, removeSlide } = await import("../../src/model/ops");
    const doc = parseDoc(HTML + `<section data-id="s2"></section>`);
    const i = duplicateSlide(doc, 0);
    expect(i).toBe(1);
    expect(doc.slides[1].id).not.toBe("s1");
    expect(findBlock(doc.slides[1], "a")).toBeUndefined();         // blocks got new ids
    expect(blocksOf(doc.slides[1].items)).toHaveLength(3);
    const j = addSlide(doc, 2);
    expect(doc.slides[j].items).toEqual([]);
    moveSlide(doc, 3, 0);
    expect(doc.slides.map((s) => s.id)[1]).toBe("s1");
    removeSlide(doc, 0);
    const html = serializeDoc(doc);
    expect(parseDoc(html).slides).toHaveLength(3);
    expect(html.indexOf('data-id="s1"')).toBeLessThan(html.lastIndexOf("<section"));
  });
});

describe("groups and slide attributes", () => {
  it("groups and ungroups without moving anything", async () => {
    const { groupBlocks, ungroupBlock } = await import("../../src/model/ops");
    const doc = parseDoc(HTML);
    const before = serializeDoc({ ...doc, slides: doc.slides.map((s) => ({ ...s, dirty: true })) });
    const gid = groupBlocks(slide(doc), ["a", "b"])!;
    const g = findBlock(slide(doc), gid)!;
    expect(g.type).toBe("group");
    expect(blocksOf(g.children!).map((b) => b.id)).toEqual(["a", "b"]);
    expect(frame(findBlock(slide(doc), "a")!)).toMatchObject({ left: 40, top: 40 });
    expect(ungroupBlock(slide(doc), gid)).toEqual(["a", "b"]);
    const after = parseDoc(serializeDoc(doc));
    expect(blocksOf(slide(after).items).map((b) => b.id).sort()).toEqual(["a", "b", "g"]);
    expect(before).toContain('data-block-id="a"');
  });

  it("sets the slide background", async () => {
    const { setSlideAttr } = await import("../../src/model/ops");
    const doc = parseDoc(HTML);
    setSlideAttr(slide(doc), "data-background-color", "#112233");
    expect(serializeDoc(doc)).toContain('<section data-id="s1" data-background-color="#112233">');
    setSlideAttr(slide(doc), "data-background-color", null);
    expect(serializeDoc(doc)).toContain('<section data-id="s1">');
  });
});

describe("lines", () => {
  it("rewrites end points, box and SVG", async () => {
    const { lineEnds, lineSpec, setLine } = await import("../../src/model/ops");
    const { lineBlock } = await import("../../src/model/factory");
    const doc = parseDoc(HTML);
    const b = lineBlock(slide(doc), [300, 200], [100, 250], true, "#ff0000");
    expect(frame(b)).toMatchObject({ left: 100, top: 200 });
    expect(lineSpec(b)).toMatchObject({ x1: 200, y1: 0, x2: 0, y2: 50, end: "line-arrow", color: "#ff0000" });
    expect(b.inner).toContain('class="line-end"');
    setLine(b, [300, 200], [400, 100]);
    expect(lineEnds(b)).toEqual({ p1: [300, 200], p2: [400, 100] });
    expect(frame(b)).toMatchObject({ left: 300, top: 100 });
  });
});

describe("image crop and opacity", () => {
  const IMG = `<section data-id="s"><div class="sl-block" data-block-type="image" style="width: 106px; height: 87px; left: 10px; top: 20px;" data-block-id="im"><div class="sl-block-content" style="z-index: 12;"><img class="" data-natural-width="640" data-natural-height="281" data-crop-x="0" data-crop-y="0" data-crop-width="0.456897" data-crop-height="0.852941" style="left: 0px; top: 0px; width: 232px; height: 102px;" src="media/a.png"></div></div></section>`;

  it("resizing a cropped image rescales the picture", async () => {
    const { imageCrop } = await import("../../src/model/ops");
    const doc = parseDoc(IMG);
    const b = findBlock(doc.slides[0], "im")!;
    setFrame(b, { width: 212, height: 174 });
    expect(b.inner).toMatch(/style="left: 0px; top: 0px; width: 464(\.\d+)?px; height: 204(\.\d+)?px;"/);
    expect(imageCrop(b).width).toBeCloseTo(0.456897, 5);
  });

  it("cropping keeps the picture in place and grows the block", async () => {
    const { imageCrop, setImageCrop } = await import("../../src/model/ops");
    const doc = parseDoc(IMG);
    const b = findBlock(doc.slides[0], "im")!;
    const full = 106 / 0.456897;
    setImageCrop(b, { x: 0, y: 0, width: 1, height: 1 });                 // un-crop
    expect(frame(b).width).toBeCloseTo(full, 2);
    expect(b.inner).not.toContain("data-crop");
    setImageCrop(b, { x: 0.25, y: 0, width: 0.5, height: 1 });           // trim a quarter each side
    expect(frame(b).left).toBeCloseTo(10 + 0.25 * full, 2);
    expect(frame(b).width).toBeCloseTo(0.5 * full, 2);
    expect(imageCrop(b)).toMatchObject({ x: 0.25, width: 0.5 });
  });

  it("opacity lives on the wrapper", async () => {
    const { opacity, setOpacity } = await import("../../src/model/ops");
    const doc = parseDoc(HTML);
    const a = findBlock(slide(doc), "a")!;
    expect(opacity(a)).toBe(100);
    setOpacity(a, 40);
    expect(a.wrapper!.attrs.find(([k]) => k === "style")![1]).toBe("z-index: 10; opacity: 0.4;");
    setOpacity(a, 100);
    expect(opacity(a)).toBe(100);
  });
});
