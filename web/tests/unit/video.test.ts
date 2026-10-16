// Video blocks: markup made by the factory, its round trip through the model, the inspector's
// accessors, the editor's display rewrites, and the runtime's play / rewind / print behaviour.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { absolutiseMedia, stillVideos } from "../../src/app/slide";
import { videoBlock } from "../../src/model/factory";
import { setVideo, videoSpec } from "../../src/model/ops";
import { parseDoc } from "../../src/model/parse";
import { blockHtml, serializeDoc } from "../../src/model/serialize";
import { enterSlide, leaveSlide, printStills } from "../../src/render/video";

const SLIDE = `<section data-id="v1"><div class="sl-block" data-block-type="video" style="width: 1024px; height: 576px; left: 0px; top: 0px;" data-block-id="vb"><div class="sl-block-content" style="z-index: 10;"><video src="media/aaa.webm" poster="media/first.png" data-print="media/last.png" muted playsinline preload="auto"><source src="media/bbb.mp4" type="video/mp4"></video></div></div></section>`;

const emptySlide = () => parseDoc(`<section data-id="s"></section>`).slides[0];

describe("video block model", () => {
  it("makes the documented markup", () => {
    const b = videoBlock(emptySlide(), "media/aaa.webm", 0, 0, 1024, 576, { poster: "media/first.png", print: "media/last.png" });
    const html = blockHtml(b);
    expect(html).toMatch(/^<div class="sl-block" data-block-type="video" style="width: 1024px; height: 576px; left: 0px; top: 0px;" data-block-id="[^"]+">/);
    expect(html).toContain('<div class="sl-block-content" style="z-index: 10;">'
      + '<video src="media/aaa.webm" poster="media/first.png" data-print="media/last.png" muted playsinline preload="auto"></video></div>');
    const plain = blockHtml(videoBlock(emptySlide(), "media/a.mp4", 0, 0, 10, 10, { loop: true, autoplay: false }));
    expect(plain).toContain('<video src="media/a.mp4" muted playsinline preload="auto" loop data-autoplay="false"></video>');
  });

  it("round-trips untouched and rebuilt", () => {
    expect(serializeDoc(parseDoc(SLIDE))).toBe(SLIDE);
    const doc = parseDoc(SLIDE);
    doc.slides[0].dirty = true;
    const rebuilt = serializeDoc(doc);
    expect(rebuilt).toContain('data-block-type="video"');
    expect(rebuilt).toContain('<source src="media/bbb.mp4" type="video/mp4">');
    const again = parseDoc(rebuilt);
    again.slides[0].dirty = true;
    expect(serializeDoc(again)).toBe(rebuilt);
  });

  it("reads and changes poster, print image, loop and autoplay", () => {
    const b = parseDoc(SLIDE).slides[0].items[0];
    if (b.kind !== "block") throw new Error("no block");
    expect(b.block.type).toBe("video");
    expect(videoSpec(b.block)).toEqual({ src: "media/aaa.webm", poster: "media/first.png", print: "media/last.png", loop: false, autoplay: true });
    setVideo(b.block, { poster: null, print: "media/other.png", loop: true, autoplay: false });
    expect(videoSpec(b.block)).toEqual({ src: "media/aaa.webm", poster: null, print: "media/other.png", loop: true, autoplay: false });
    expect(b.block.inner).toContain('data-autoplay="false"');
    setVideo(b.block, { autoplay: true, loop: false });
    expect(b.block.inner).not.toContain("data-autoplay");
    expect(b.block.inner).not.toContain("loop");
    setVideo(b.block, { poster: "media/p.png" });
    expect(b.block.inner).toMatch(/^<video src="media\/aaa.webm" poster="media\/p.png" data-print="media\/other.png" muted=""/);
  });
});

describe("editor display", () => {
  it("points src, poster and data-print at the deck, and does not buffer clips", () => {
    const html = stillVideos(absolutiseMedia(SLIDE, "2026-10_test"));
    expect(html).toContain('src="/view/2026-10_test/media/aaa.webm"');
    expect(html).toContain('poster="/view/2026-10_test/media/first.png"');
    expect(html).toContain('data-print="/view/2026-10_test/media/last.png"');
    expect(html).toContain('<source src="/view/2026-10_test/media/bbb.mp4"');
    expect(html).toContain('preload="metadata"');
  });
});

describe("runtime", () => {
  let played: HTMLMediaElement[], paused: HTMLMediaElement[];
  beforeEach(() => {
    played = [];
    paused = [];
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) { played.push(this); return Promise.resolve(); });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) { paused.push(this); });
  });
  afterEach(() => vi.restoreAllMocks());

  const section = (html: string) => {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    return tpl.content.querySelector("section") as HTMLElement;
  };
  const times = new WeakMap<HTMLMediaElement, number>();
  const trackTime = (v: HTMLVideoElement) => Object.defineProperty(v, "currentTime", {
    get: () => times.get(v) ?? 7, set: (t: number) => times.set(v, t), configurable: true });

  it("plays autoplay videos from 0 on enter, pauses and rewinds on leave", () => {
    const s = section(SLIDE.replace("</div></div></section>",
      '</div></div><div class="sl-block" data-block-type="video" data-block-id="m"><div class="sl-block-content"><video src="media/c.webm" data-autoplay="false"></video></div></div></section>'));
    const [auto, manual] = [...s.querySelectorAll("video")];
    trackTime(auto);
    trackTime(manual);
    expect(auto.currentTime).toBe(7);
    enterSlide(s);
    expect(played).toEqual([auto]);
    expect(auto.currentTime).toBe(0);
    expect(auto.muted).toBe(true);
    expect(manual.currentTime).toBe(7);
    times.set(auto, 12);
    leaveSlide(s);
    expect(paused).toEqual([auto, manual]);
    expect(auto.currentTime).toBe(0);
    expect(manual.currentTime).toBe(7);
  });

  it("print mode swaps each video for its print image, else its poster", async () => {
    const s = section(SLIDE.replace("</div></div></section>",
      '</div></div><div class="sl-block" data-block-type="video" data-block-id="p"><div class="sl-block-content"><video src="media/c.webm" poster="media/c.png"></video></div></div></section>'));
    await printStills(s);
    expect(s.querySelector("video")).toBeNull();
    expect([...s.querySelectorAll("img.od-video-still")].map((i) => i.getAttribute("src"))).toEqual(["media/last.png", "media/c.png"]);
  });

  it("print mode keeps a video without any still and does not hang", async () => {
    const s = section(`<section><div class="sl-block" data-block-type="video" data-block-id="n"><div class="sl-block-content"><video src="media/none.webm"></video></div></div></section>`);
    await printStills(s, 50);
    expect(s.querySelector("video")).not.toBeNull();
  });
});
