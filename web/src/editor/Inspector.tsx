// Settings of the selected block (right-hand panel), like the slides.com inspector.
import { useMemo, useState } from "preact/hooks";
import { attr, contentScale, findBlock, frame, groupBlocks, lineEnds, lineSpec, mathTex, rotation, setContentScale, setFrame,
  setLine, setMathTex, setRotation, setShape, setSlideAttr, shapeSpec, ungroupBlock,
  imageCrop, setImageCrop, opacity, setOpacity } from "../model/ops";
import { SHAPES } from "../render/shape";
import { serializeDoc } from "../model/serialize";
import { getStyle, setAttr, setStyle } from "../model/style";
import type { Block } from "../model/types";
import { BASIC_COLOURS, FONTS, deckColours } from "./fonts";
import type { Editor } from "./store";

function Num({ label, value, onChange, step = 1, unit }: { label: string; value: number | null; onChange: (v: number) => void; step?: number; unit?: string }) {
  return (
    <label class="od-num">
      <span>{label}{unit ? ` (${unit})` : ""}</span>
      <input type="number" step={step} value={value === null ? "" : Math.round(value * 10) / 10} placeholder="auto"
        onChange={(e) => { const v = parseFloat((e.target as HTMLInputElement).value); if (!Number.isNaN(v)) onChange(v); }} />
    </label>
  );
}

/** A colour field: swatch that opens the deck's colours, basic colours and a free choice. */
function Colour({ label, value, deck, onPick, onClear }: {
  label: string; value: string | null; deck: string[]; onPick: (c: string) => void; onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pick = (c: string) => { onPick(c); setOpen(false); };
  return (
    <div class="od-num od-tb-colour">
      <span>{label}</span>
      <span>
        <button class="od-swatch-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span class={value ? "" : "od-swatch-none"} style={value ? { background: value } : undefined} title={value ?? "Not set"} />
        </button>
        {onClear && value && <button class="od-mini" title={`No ${label.toLowerCase()}`} onClick={onClear}>×</button>}
      </span>
      {open && (
        <div class="od-palette" style={{ left: "auto", right: 0 }}>
          {deck.length > 0 && <>
            <h4>Colours in this deck</h4>
            <div class="od-swatches">{deck.map((c) => <button title={c} style={{ background: c }} onClick={() => pick(c)} />)}</div>
          </>}
          <h4>Basic colours</h4>
          <div class="od-swatches">{BASIC_COLOURS.map((c) => <button title={c} style={{ background: c }} onClick={() => pick(c)} />)}</div>
          <label>Other colour <input type="color" value={value ?? "#000000"} onChange={(e) => pick((e.target as HTMLInputElement).value)} /></label>
        </div>
      )}
    </div>
  );
}

const TITLES: Record<string, string> = { text: "Text", math: "Maths", image: "Image", shape: "Shape", line: "Line",
  drawing: "Drawing", group: "Group" };

export function Inspector({ editor }: { editor: Editor }) {
  const sel = editor.selection.value;
  const deck = useMemo(() => deckColours(serializeDoc(editor.doc.value)), [editor.doc.value]);
  const block = sel.length === 1 && editor.slide ? findBlock(editor.slide, sel[0]) : undefined;

  if (!block && editor.tool.value === "pen") {
    const pen = editor.pen.value;
    return (
      <aside class="od-inspector" aria-label="Pen">
        <h3>Pen</h3>
        <section>
          <Colour label="Colour" value={pen.colour} deck={deck} onPick={(c) => (editor.pen.value = { ...pen, colour: c })} />
          <Num label="Thickness" unit="px" value={pen.size} onChange={(v) => (editor.pen.value = { ...pen, size: Math.max(1, v) })} />
          <p class="od-hint">Draw on the slide. Each stroke becomes a drawing you can move. Esc stops the pen.</p>
        </section>
      </aside>
    );
  }
  if (!block) {
    const slide = editor.slide;
    const bg = slide?.attrs.find(([k]) => k === "data-background-color")?.[1] ?? null;
    const setBg = (v: string | null) => editor.edit("Background", (doc) => setSlideAttr(doc.slides[editor.current.value], "data-background-color", v), "bg");
    if (sel.length > 1) {
      return (
        <aside class="od-inspector" aria-label="Selection">
          <h3>{sel.length} blocks selected</h3>
          <button onClick={() => { let g: string | null = null;
            editor.edit("Group", (doc) => { g = groupBlocks(doc.slides[editor.current.value], sel); });
            if (g) editor.selection.value = [g]; }}>Group them (Ctrl+G)</button>
        </aside>
      );
    }
    return (
      <aside class="od-inspector" aria-label="Slide">
        <h3>Slide {editor.current.value + 1}</h3>
        <section>
          <Colour label="Background" value={bg} deck={deck} onPick={setBg} onClear={() => setBg(null)} />
        </section>
        <section>
          <button onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "H", code: "KeyH", altKey: true, shiftKey: true, bubbles: true }))}>
            Edit the slide's HTML (Alt+Shift+H)</button>
        </section>
        <section>
          <p class="od-hint">Click a block to change it. Double-click text or maths to edit its content.
            Drop or paste an image onto the slide to add it.</p>
        </section>
      </aside>
    );
  }

  const id = block.id;
  const change = (label: string, f: (b: Block) => void, key?: string) =>
    editor.edit(label, (doc) => {
      const s = doc.slides[editor.current.value];
      const b = findBlock(s, id);
      if (b) { f(b); s.dirty = true; }
    }, key);
  const fr = frame(block);
  const textColour = getStyle(block.content, "color");
  const font = getStyle(block.content, "font-family");

  return (
    <aside class="od-inspector" aria-label={TITLES[block.type] ?? block.type}>
      <h3>{TITLES[block.type] ?? block.type}</h3>

      {block.type === "text" && (
        <section>
          <label class="od-num"><span>Font</span>
            <select value={font ?? ""} onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              change("Font", (b) => setStyle(b.content, "font-family", v || null));
            }}>
              <option value="">Deck default</option>
              {FONTS.map((f) => <option value={f.css}>{f.label}</option>)}
            </select>
          </label>
          <Colour label="Text colour" value={textColour} deck={deck}
            onPick={(c) => change("Text colour", (b) => setStyle(b.content, "color", c))}
            onClear={() => change("Text colour", (b) => setStyle(b.content, "color", null))} />
          <Num label="Text size" unit="%" value={contentScale(block)} step={5}
            onChange={(v) => change("Text size", (b) => setContentScale(b, v), `scale-${id}`)} />
          <p class="od-hint">Applies to the whole block. To change part of the text, double-click it and use the toolbar.</p>
        </section>
      )}

      {block.type === "math" && (
        <section>
          <h4>LaTeX</h4>
          <textarea class="od-tex" rows={5} spellcheck={false} value={mathTex(block)} placeholder="Type or paste LaTeX"
            onInput={(e) => change("Edit maths", (b) => setMathTex(b, (e.target as HTMLTextAreaElement).value), `tex-${id}`)} />
          <label class="od-check">
            <input type="checkbox" checked={attr(block.content, "data-math-display") === "true"}
              onChange={(e) => change("Display mode", (b) => setAttr(b.content, "data-math-display",
                (e.target as HTMLInputElement).checked ? "true" : "false"))} /> Display style (larger fractions and sums)
          </label>
          <Num label="Size" unit="%" value={contentScale(block)} step={5} onChange={(v) => change("Size", (b) => setContentScale(b, v), `scale-${id}`)} />
          <Colour label="Colour" value={textColour} deck={deck}
            onPick={(c) => change("Colour", (b) => setStyle(b.content, "color", c))}
            onClear={() => change("Colour", (b) => setStyle(b.content, "color", null))} />
        </section>
      )}

      {block.type === "shape" && (() => {
        const sh = shapeSpec(block);
        const icon = sh.type.startsWith("symbol-");
        const transparent = /rgba\(.*,\s*0\)$/.test(sh.fill);
        return (
          <section>
            {!icon && (
              <label class="od-num"><span>Shape</span>
                <select value={sh.type} onChange={(e) => change("Shape", (b) => setShape(b, { type: (e.target as HTMLSelectElement).value }))}>
                  {SHAPES.map(([v, l]) => <option value={v}>{l}</option>)}
                </select>
              </label>
            )}
            <Colour label="Fill" value={transparent ? null : sh.fill} deck={deck}
              onPick={(c) => change("Fill", (b) => setShape(b, { fill: c }))}
              onClear={icon ? undefined : () => change("Fill", (b) => setShape(b, { fill: "rgba(0, 0, 0, 0)" }))} />
            {!icon && <>
              <Colour label="Border" value={sh.stroke && sh.strokeWidth > 0 ? sh.stroke : null} deck={deck}
                onPick={(c) => change("Border", (b) => setShape(b, { stroke: c, strokeWidth: sh.strokeWidth || 2 }))}
                onClear={() => change("Border", (b) => setShape(b, { stroke: null, strokeWidth: 0 }))} />
              {sh.stroke && sh.strokeWidth > 0 && (
                <Num label="Border thickness" unit="px" value={sh.strokeWidth}
                  onChange={(v) => change("Border", (b) => setShape(b, { strokeWidth: Math.max(0, v) }))} />
              )}
              {sh.type === "rect" && (
                <Num label="Corner radius" unit="px" value={sh.radius}
                  onChange={(v) => change("Corners", (b) => setShape(b, { radius: Math.max(0, v) }), `radius-${id}`)} />
              )}
            </>}
          </section>
        );
      })()}

      {block.type === "line" && (() => {
        const ls = lineSpec(block);
        const upd = (patch: Parameters<typeof setLine>[3], key?: string) =>
          change("Line", (b) => { const e = lineEnds(b); setLine(b, e.p1, e.p2, patch); }, key);
        const caps: [string, string][] = [["none", "None"], ["line-arrow", "Open arrow"], ["arrow", "Filled arrow"]];
        return (
          <section>
            <Colour label="Colour" value={ls.color} deck={deck} onPick={(c) => upd({ color: c })} />
            <Num label="Thickness" unit="px" value={ls.width} onChange={(v) => upd({ width: Math.max(1, v) })} />
            <label class="od-num"><span>Start</span>
              <select value={ls.start} onChange={(e) => upd({ start: (e.target as HTMLSelectElement).value })}>
                {caps.map(([v, l]) => <option value={v}>{l}</option>)}</select></label>
            <label class="od-num"><span>End</span>
              <select value={ls.end} onChange={(e) => upd({ end: (e.target as HTMLSelectElement).value })}>
                {caps.map(([v, l]) => <option value={v}>{l}</option>)}</select></label>
            <label class="od-num"><span>Style</span>
              <select value={ls.style === "dashed" ? "dashed" : "solid-rounded"} onChange={(e) => upd({ style: (e.target as HTMLSelectElement).value })}>
                <option value="solid-rounded">Solid</option><option value="dashed">Dashed</option></select></label>
          </section>
        );
      })()}

      {block.type === "image" && (() => {
        const c = imageCrop(block);
        const pct = (v: number) => Math.round(v * 1000) / 10;
        const trim = { left: c.x, right: 1 - c.x - c.width, top: c.y, bottom: 1 - c.y - c.height };
        const setTrim = (side: keyof typeof trim, value: number) => {
          const t = { ...trim, [side]: Math.max(0, Math.min(0.95, value / 100)) };
          const width = 1 - t.left - t.right, height = 1 - t.top - t.bottom;
          if (width < 0.02 || height < 0.02) return;
          change("Crop", (b) => setImageCrop(b, { x: t.left, y: t.top, width, height }), `crop-${id}-${side}`);
        };
        const cropped = trim.left || trim.right || trim.top || trim.bottom;
        return (
          <section>
            <h4>Crop (% of the image)</h4>
            <div class="od-grid2" style={{ display: "grid", gap: "8px 12px" }}>
              <Num label="Left" value={pct(trim.left)} step={1} onChange={(v) => setTrim("left", v)} />
              <Num label="Right" value={pct(trim.right)} step={1} onChange={(v) => setTrim("right", v)} />
              <Num label="Top" value={pct(trim.top)} step={1} onChange={(v) => setTrim("top", v)} />
              <Num label="Bottom" value={pct(trim.bottom)} step={1} onChange={(v) => setTrim("bottom", v)} />
            </div>
            {cropped ? <button onClick={() => change("Remove crop", (b) => setImageCrop(b, { x: 0, y: 0, width: 1, height: 1 }))}>Remove crop</button> : null}
          </section>
        );
      })()}

      {block.type === "drawing" && (() => {
        const tpl = document.createElement("template");
        tpl.innerHTML = block.inner;
        const current = tpl.content.querySelector("path")?.getAttribute("fill") ?? "#000000";
        return (
          <section>
            <Colour label="Colour" value={current} deck={deck} onPick={(c) => change("Colour", (b) => {
              const t = document.createElement("template");
              t.innerHTML = b.inner;
              t.content.querySelectorAll("path").forEach((el) => el.setAttribute("fill", c));
              b.inner = t.innerHTML;
            })} />
          </section>
        );
      })()}

      {block.type === "group" && (
        <section>
          <button onClick={() => { let kids: string[] = [];
            editor.edit("Ungroup", (doc) => { kids = ungroupBlock(doc.slides[editor.current.value], id); });
            editor.selection.value = kids; }}>Ungroup (Ctrl+Shift+G)</button>
        </section>
      )}

      {block.type !== "group" && block.type !== "line" && (
        <section>
          <h4>Position and size</h4>
          <div class="od-grid2" style={{ display: "grid", gap: "8px 12px" }}>
            <Num label="X" value={fr.left} onChange={(v) => change("Move", (b) => setFrame(b, { left: v }))} />
            <Num label="Y" value={fr.top} onChange={(v) => change("Move", (b) => setFrame(b, { top: v }))} />
            <Num label="W" value={fr.width} onChange={(v) => change("Resize", (b) => setFrame(b, { width: v }))} />
            <Num label="H" value={fr.height} onChange={(v) => change("Resize", (b) => setFrame(b, { height: v }))} />
          </div>
          <Num label="Rotation" unit="°" value={rotation(block)} onChange={(v) => change("Rotate", (b) => setRotation(b, v))} />
          <Num label="Opacity" unit="%" value={opacity(block)} step={5} onChange={(v) => change("Opacity", (b) => setOpacity(b, v), `opacity-${id}`)} />
        </section>
      )}
    </aside>
  );
}
