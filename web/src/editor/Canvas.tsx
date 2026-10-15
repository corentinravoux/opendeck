// The slide canvas: renders the current slide with the shared renderer, and an overlay for
// selection, dragging (with snapping) and resizing. Live feedback moves the DOM directly;
// the model is updated once, when the pointer is released (one undo step).
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { blocksOf, findBlock, frame, lineEnds, moveBlock, rotation, setFrame, setLine, setRotation } from "../model/ops";
import { drawingBlock, lineBlock } from "../model/factory";
import { drawingFrom } from "../render/drawing";
import { slideHtml } from "../model/serialize";
import { renderSlide } from "../app/slide";
import type { Editor } from "./store";
import { snap, type Box, type Guide } from "./snap";
import { imageFiles, insertImages } from "./media";
import { TextToolbar, useTextEditing } from "./TextEditing";
import { deckColours } from "./fonts";
import { serializeDoc } from "../model/serialize";
import { useMemo } from "preact/hooks";

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type Handle = (typeof HANDLES)[number];

/** Top-level block element under a DOM node (a block inside a group selects the group). */
function topBlock(el: Element | null, section: Element): HTMLElement | null {
  let found: HTMLElement | null = null;
  for (let n = el; n && n !== section; n = n.parentElement) {
    if (n.classList.contains("sl-block")) found = n as HTMLElement;
  }
  return found;
}

function boxOf(el: HTMLElement, section: HTMLElement, scale: number): Box {
  const r = el.getBoundingClientRect(), s = section.getBoundingClientRect();
  if (el.dataset.blockType === "group") {
    // a group has no frame: use the union of its children
    const kids = [...el.querySelectorAll<HTMLElement>(".sl-block")].map((k) => k.getBoundingClientRect());
    if (kids.length) {
      const l = Math.min(...kids.map((k) => k.left)), t = Math.min(...kids.map((k) => k.top));
      const rr = Math.max(...kids.map((k) => k.right)), b = Math.max(...kids.map((k) => k.bottom));
      return { left: (l - s.left) / scale, top: (t - s.top) / scale, width: (rr - l) / scale, height: (b - t) / scale };
    }
  }
  return { left: (r.left - s.left) / scale, top: (r.top - s.top) / scale, width: r.width / scale, height: r.height / scale };
}

export function Canvas({ editor }: { editor: Editor }) {
  const pendingEdit = editor.pendingEdit;
  const wrap = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [ghost, setGhost] = useState<{ p1: [number, number]; p2: [number, number] } | null>(null);
  const [ink, setInk] = useState<[number, number][] | null>(null);
  const text = useTextEditing(editor);
  const colours = useMemo(() => (text.editing ? deckColours(serializeDoc(editor.doc.value)) : []), [text.editing]);
  const editingEl = () => (text.editing ? blockEl(text.editing)?.querySelector<HTMLElement>(".sl-block-content") ?? null : null);
  editor.flushText = text.editing ? () => text.commit(editingEl()) : null;
  const meta = editor.deck.meta;
  const zoom = editor.zoom.value;
  const shown = width * zoom;
  const scale = shown / meta.width;
  const slide = editor.slide;
  const html = slide ? slideHtml(slide) : "";
  const selection = editor.selection.value;

  useLayoutEffect(() => {
    const el = wrap.current!;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setWidth(Math.max(200, Math.min(r.width - 64, ((r.height - 48) * meta.width) / meta.height)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const section = () => host.current?.querySelector<HTMLElement>(".slides > section") ?? null;
  const blockEl = (id: string) => section()?.querySelector<HTMLElement>(`:scope > .sl-block[data-block-id="${CSS.escape(id)}"]`) ?? null;

  const measure = () => {
    const sec = section();
    if (!sec) return;
    const out: Record<string, Box> = {};
    for (const id of editor.selection.value) {
      const el = blockEl(id);
      if (el) out[id] = boxOf(el, sec, scale);
    }
    setBoxes(out);
  };

  useEffect(() => {
    if (width > 0 && slide && !text.editing) {
      renderSlide(host.current!, html, editor.name, meta, shown);
      requestAnimationFrame(measure);
    }
  }, [html, width, zoom, text.editing]);
  useEffect(measure, [selection, width, zoom]);
  useEffect(() => {
    // a text block just inserted from the rail: start editing it with its text selected
    const id = pendingEdit.value;
    if (!id) return;
    const el = blockEl(id)?.querySelector<HTMLElement>(".sl-block-content");
    if (el) { pendingEdit.value = null; text.start(id, el, true); }
  }, [html, pendingEdit.value]);

  // --- pointer interaction -------------------------------------------------------------
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const sec = section();
    if (!sec) return;
    const live = editingEl();
    if (live && live.contains(e.target as Node)) return;
    if (live) text.commit(live);
    if (editor.tool.value === "pen") {
      startPen(e, sec);
      return;
    }
    if (editor.tool.value) {
      startDraw(e, sec, editor.tool.value === "arrow");
      return;
    }
    const target = topBlock(e.target as Element, sec);
    if (!target) {
      startMarquee(e, sec);
      return;
    }
    const id = target.dataset.blockId!;
    let sel = editor.selection.value;
    if (e.shiftKey) sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    else if (!sel.includes(id)) sel = [id];
    editor.selection.value = sel;
    if (!sel.includes(id)) return;
    startDrag(e, sel, null, e.shiftKey ? undefined : id);
  };

  const startMarquee = (e: PointerEvent, sec: HTMLElement) => {
    e.preventDefault();
    const s = sec.getBoundingClientRect();
    const x0 = (e.clientX - s.left) / scale, y0 = (e.clientY - s.top) / scale;
    const keep = e.shiftKey ? editor.selection.value : [];
    if (!e.shiftKey) editor.selection.value = [];
    const onMove = (ev: PointerEvent) => {
      const x1 = (ev.clientX - s.left) / scale, y1 = (ev.clientY - s.top) / scale;
      setMarquee({ left: Math.min(x0, x1), top: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) });
    };
    const onUp = (ev: PointerEvent) => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      setMarquee(null);
      const x1 = (ev.clientX - s.left) / scale, y1 = (ev.clientY - s.top) / scale;
      const m = { left: Math.min(x0, x1), top: Math.min(y0, y1), right: Math.max(x0, x1), bottom: Math.max(y0, y1) };
      if (m.right - m.left < 2 && m.bottom - m.top < 2) return;
      const hit = [...sec.querySelectorAll<HTMLElement>(":scope > .sl-block")].filter((el) => {
        const b = boxOf(el, sec, scale);
        return b.left < m.right && b.left + b.width > m.left && b.top < m.bottom && b.top + b.height > m.top;
      }).map((el) => el.dataset.blockId!);
      editor.selection.value = [...new Set([...keep, ...hit])];
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
  };

  const toSlide = (ev: PointerEvent, sec: HTMLElement): [number, number] => {
    const r = sec.getBoundingClientRect();
    return [(ev.clientX - r.left) / scale, (ev.clientY - r.top) / scale];
  };
  /** Shift: snap the segment to multiples of 15°. */
  const snapAngle = (p1: [number, number], p2: [number, number], on: boolean): [number, number] => {
    if (!on) return p2;
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1], L = Math.hypot(dx, dy);
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
    return [p1[0] + L * Math.cos(a), p1[1] + L * Math.sin(a)];
  };

  const startDraw = (e: PointerEvent, sec: HTMLElement, arrow: boolean) => {
    e.preventDefault();
    const p1 = toSlide(e, sec);
    let p2 = p1;
    const onMove = (ev: PointerEvent) => { p2 = snapAngle(p1, toSlide(ev, sec), ev.shiftKey); setGhost({ p1, p2 }); };
    const onUp = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      setGhost(null);
      editor.tool.value = null;
      if (Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) < 3) return;
      let id = "";
      editor.edit(arrow ? "Draw arrow" : "Draw line", (doc) => {
        const s = doc.slides[editor.current.value];
        const b = lineBlock(s, p1, p2, arrow);
        s.items.push({ kind: "block", block: b });
        s.dirty = true;
        id = b.id;
      });
      editor.selection.value = [id];
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
  };

  /** Pen: each stroke becomes a drawing block; the tool stays on until Esc or another tool. */
  const startPen = (e: PointerEvent, sec: HTMLElement) => {
    e.preventDefault();
    const pts: [number, number][] = [toSlide(e, sec)];
    setInk([...pts]);
    const onMove = (ev: PointerEvent) => { pts.push(toSlide(ev, sec)); setInk([...pts]); };
    const onUp = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      setInk(null);
      const { colour, size } = editor.pen.value;
      const d = pts.length > 1 ? drawingFrom(pts, colour, size) : null;
      if (!d) return;
      editor.edit("Draw", (doc) => {
        const s = doc.slides[editor.current.value];
        s.items.push({ kind: "block", block: drawingBlock(s, d) });
        s.dirty = true;
      });
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
  };

  const startEndpoint = (e: PointerEvent, id: string, which: 1 | 2) => {
    e.preventDefault();
    e.stopPropagation();
    const sec = section()!;
    const ends = lineEnds(findBlock(editor.slide, id)!);
    const fixed = which === 1 ? ends.p2 : ends.p1;
    let moving = which === 1 ? ends.p1 : ends.p2;
    const onMove = (ev: PointerEvent) => {
      moving = snapAngle(fixed, toSlide(ev, sec), ev.shiftKey);
      setGhost(which === 1 ? { p1: moving, p2: fixed } : { p1: fixed, p2: moving });
    };
    const onUp = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      setGhost(null);
      editor.edit("Move line end", (doc) => {
        const s = doc.slides[editor.current.value];
        const b = findBlock(s, id)!;
        if (which === 1) setLine(b, moving, fixed); else setLine(b, fixed, moving);
        s.dirty = true;
      });
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
  };

  const startRotate = (e: PointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const sec = section()!;
    const el = blockEl(id)!;
    const b = boxOf(el, sec, scale);
    const s = sec.getBoundingClientRect();
    const cx = s.left + (b.left + b.width / 2) * scale, cy = s.top + (b.top + b.height / 2) * scale;
    const start = rotation(findBlock(editor.slide, id)!);
    let deg = start;
    const onMove = (ev: PointerEvent) => {
      deg = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = ((deg + 540) % 360) - 180;
      el.style.rotate = `${deg - start}deg`;
    };
    const onUp = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      el.style.rotate = "";
      if (deg !== start) {
        editor.edit("Rotate", (doc) => {
          const sl = doc.slides[editor.current.value];
          setRotation(findBlock(sl, id)!, deg);
          sl.dirty = true;
        });
      }
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
  };

  const startDrag = (e: PointerEvent, ids: string[], handle: Handle | null, clicked?: string) => {
    e.preventDefault();
    e.stopPropagation();
    const sec = section()!;
    const els = ids.map(blockEl).filter((x): x is HTMLElement => !!x);
    const start = Object.fromEntries(els.map((el) => [el.dataset.blockId!, boxOf(el, sec, scale)]));
    const startStyle = els.map((el) => ({ el, left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height }));
    const others = [...sec.querySelectorAll<HTMLElement>(":scope > .sl-block")]
      .filter((el) => !ids.includes(el.dataset.blockId!)).map((el) => boxOf(el, sec, scale));
    const union = (() => {
      const bs = Object.values(start);
      const l = Math.min(...bs.map((b) => b.left)), t = Math.min(...bs.map((b) => b.top));
      return { left: l, top: t, width: Math.max(...bs.map((b) => b.left + b.width)) - l,
               height: Math.max(...bs.map((b) => b.top + b.height)) - t };
    })();
    const x0 = e.clientX, y0 = e.clientY;
    let dx = 0, dy = 0, moved = false;
    let resized: Box | null = null;
    const autoHeight = (id: string) => frame(findBlock(editor.slide, id)!).height === null;

    const onMove = (ev: PointerEvent) => {
      let mx = (ev.clientX - x0) / scale, my = (ev.clientY - y0) / scale;
      if (!moved && Math.hypot(mx, my) * scale < 3) return;
      moved = true;
      if (handle === null) {
        if (ev.shiftKey) Math.abs(mx) > Math.abs(my) ? (my = 0) : (mx = 0);
        const s = ev.altKey ? { dx: 0, dy: 0, guides: [] } :
          snap({ ...union, left: union.left + mx, top: union.top + my }, others, meta, 6 / scale);
        dx = mx + s.dx;
        dy = my + s.dy;
        setGuides(s.guides);
        for (const st of startStyle) {
          st.el.style.translate = `${dx}px ${dy}px`;
        }
        setBoxes(Object.fromEntries(Object.entries(start).map(([k, b]) => [k, { ...b, left: b.left + dx, top: b.top + dy }])));
      } else {
        const b = start[ids[0]];
        let { left, top, width: w, height: h } = b;
        if (handle.includes("e")) w = Math.max(4, b.width + mx);
        if (handle.includes("w")) { w = Math.max(4, b.width - mx); left = b.left + b.width - w; }
        if (handle.includes("s")) h = Math.max(4, b.height + my);
        if (handle.includes("n")) { h = Math.max(4, b.height - my); top = b.top + b.height - h; }
        if (ev.shiftKey && (handle.length === 2)) {
          const ratio = b.width / b.height;
          if (w / h > ratio) w = h * ratio; else h = w / ratio;
          if (handle.includes("w")) left = b.left + b.width - w;
          if (handle.includes("n")) top = b.top + b.height - h;
        }
        resized = { left, top, width: w, height: h };
        const el = startStyle[0].el;
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.width = `${w}px`;
        if (!autoHeight(ids[0])) el.style.height = `${h}px`;
        setBoxes({ [ids[0]]: autoHeight(ids[0]) ? boxOf(el, sec, scale) : resized });
      }
    };
    const onUp = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      setGuides([]);
      for (const st of startStyle) st.el.style.translate = "";
      if (!moved) {
        // a click (no drag) on one block of a multi-selection selects just that block
        if (clicked && ids.length > 1) editor.selection.value = [clicked];
        return;
      }
      if (handle === null && (dx || dy)) {
        editor.edit("Move", (doc) => {
          const s = doc.slides[editor.current.value];
          for (const id of ids) moveBlock(findBlock(s, id)!, dx, dy);
          s.dirty = true;
        });
      } else if (resized) {
        const r: Box = resized;
        editor.edit("Resize", (doc) => {
          const s = doc.slides[editor.current.value];
          const b = findBlock(s, ids[0])!;
          setFrame(b, { left: r.left, top: r.top, width: r.width, height: frame(b).height === null ? null : r.height });
          s.dirty = true;
        });
      }
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
  };

  const single = selection.length === 1 ? boxes[selection[0]] : null;
  const singleType = selection.length === 1 ? findBlock(editor.slide, selection[0])?.type : undefined;
  const resizable = single && singleType !== "group" && singleType !== "line" && singleType !== "math";
  const lineSel = singleType === "line" ? lineEnds(findBlock(editor.slide, selection[0])!) : null;
  const autoH = single && selection[0] && editor.slide ? frame(findBlock(editor.slide, selection[0])!).height === null : false;

  return (
    <div class={`od-canvas${zoom > 1 ? " od-zoomed" : ""}`} ref={wrap} onPointerDown={(e) => e.target === wrap.current && (editor.selection.value = [])}
      onWheel={(e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        editor.zoom.value = Math.max(0.25, Math.min(4, editor.zoom.value * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      }}
      onDragOver={(e) => { if ([...(e.dataTransfer?.types ?? [])].includes("Files")) { e.preventDefault(); e.dataTransfer!.dropEffect = "copy"; } }}
      onDrop={(e) => {
        const files = imageFiles(e.dataTransfer);
        e.preventDefault();
        if (!files.length) return;
        const sec = section();
        const r = sec?.getBoundingClientRect();
        const x = r ? (e.clientX - r.left) / scale : meta.width / 2, y = r ? (e.clientY - r.top) / scale : meta.height / 2;
        void insertImages(editor, files, x, y);
      }}>
      <div class={`od-canvas-stage${editor.tool.value ? " od-drawing" : ""}`} style={{ width: `${shown}px`, height: `${meta.height * scale}px` }}>
        <div class="od-canvas-slide" ref={host} onPointerDown={onPointerDown as any}
          onDblClick={(e) => {
            const sec = section();
            const el = sec && topBlock(e.target as Element, sec);
            if (el?.dataset.blockType === "math") {
              editor.selection.value = [el.dataset.blockId!];
              setTimeout(() => document.querySelector<HTMLTextAreaElement>(".od-tex")?.focus(), 0);
            }
            if (el?.dataset.blockType === "text") {
              editor.selection.value = [el.dataset.blockId!];
              text.start(el.dataset.blockId!, el.querySelector<HTMLElement>(".sl-block-content")!);
            }
          }}
          onKeyDown={(e) => { if (e.key === "Escape" && text.editing) { e.stopPropagation(); text.commit(editingEl()); } }} />
        <div class="od-overlay">
          {Object.entries(boxes).filter(([id]) => selection.includes(id)).map(([id, b]) => (
            <div key={id} class="od-sel" style={{ left: `${b.left * scale}px`, top: `${b.top * scale}px`,
              width: `${b.width * scale}px`, height: `${b.height * scale}px` }} />
          ))}
          {resizable && single && HANDLES.filter((h) => !autoH || !/[ns]/.test(h)).map((h) => (
            <div key={h} class={`od-handle od-h-${h}`} onPointerDown={(e) => startDrag(e as any, selection, h)}
              style={{ left: `${(single.left + (h.includes("w") ? 0 : h.includes("e") ? single.width : single.width / 2)) * scale}px`,
                       top: `${(single.top + (h.includes("n") ? 0 : h.includes("s") ? single.height : single.height / 2)) * scale}px` }} />
          ))}
          {lineSel && !ghost && ([1, 2] as const).map((k) => {
            const p = k === 1 ? lineSel.p1 : lineSel.p2;
            return <div key={k} class="od-handle od-endpoint" onPointerDown={(e) => startEndpoint(e as any, selection[0], k)}
              style={{ left: `${p[0] * scale}px`, top: `${p[1] * scale}px` }} />;
          })}
          {ink && ink.length > 1 && (
            <svg class="od-ghost" width="100%" height="100%">
              <polyline points={ink.map(([x, y]) => `${x * scale},${y * scale}`).join(" ")} fill="none"
                stroke={editor.pen.value.colour} stroke-width={editor.pen.value.size * scale} stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          )}
          {ghost && (
            <svg class="od-ghost" width="100%" height="100%">
              <line x1={ghost.p1[0] * scale} y1={ghost.p1[1] * scale} x2={ghost.p2[0] * scale} y2={ghost.p2[1] * scale} />
            </svg>
          )}
          {single && singleType !== "group" && singleType !== "line" && (
            <div class="od-rotate" title="Rotate (Shift: 15° steps)" onPointerDown={(e) => startRotate(e as any, selection[0])}
              style={{ left: `${(single.left + single.width / 2) * scale}px`, top: `${single.top * scale - 26}px` }} />
          )}
          {marquee && (
            <div class="od-marquee" style={{ left: `${marquee.left * scale}px`, top: `${marquee.top * scale}px`,
              width: `${marquee.width * scale}px`, height: `${marquee.height * scale}px` }} />
          )}
          {single && !text.editing && (
            <div class="od-size" style={{ left: `${(single.left + single.width / 2) * scale}px`, top: `${(single.top + single.height) * scale + 8}px` }}>
              {Math.round(single.width)} × {Math.round(single.height)}
            </div>
          )}
          {text.editing && boxes[text.editing] && (
            <TextToolbar x={Math.max(0, boxes[text.editing].left * scale)} deckColours={colours}
              y={boxes[text.editing].top * scale >= 46 ? boxes[text.editing].top * scale - 46
                : (boxes[text.editing].top + boxes[text.editing].height) * scale + 8} />
          )}
          {guides.map((g, i) => (
            <div key={i} class={`od-guide od-guide-${g.axis}`} style={g.axis === "x" ? { left: `${g.at * scale}px` } : { top: `${g.at * scale}px` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
