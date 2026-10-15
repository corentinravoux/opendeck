// Settings of the selected block (the Design tab of the side panel), like the slides.com inspector.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { attr, contentScale, findBlock, frame, groupBlocks, lineEnds, lineSpec, mathTex, rotation, setContentScale, setFrame,
  setLine, setMathTex, setRotation, setShape, setSlideAttr, shapeSpec, ungroupBlock,
  imageCrop, setImageCrop, opacity, setOpacity } from "../model/ops";
import { SHAPES } from "../render/shape";
import { serializeDoc } from "../model/serialize";
import { getStyle, setAttr, setStyle } from "../model/style";
import type { Block } from "../model/types";
import { Icon, type IconName } from "../app/icons";
import { FONTS, deckColours } from "./fonts";
import { Palette } from "./Palette";
import type { Editor } from "./store";

/** A number field. `prefix` puts a short label inside the field (X, Y, W, H). */
function Num({ label, value, onChange, step = 1, unit, prefix = false }: {
  label: string; value: number | null; onChange: (v: number) => void; step?: number; unit?: string; prefix?: boolean;
}) {
  const field = (
    <span class="od-input">
      {prefix && <b>{label}</b>}
      <input type="number" step={step} value={value === null ? "" : Math.round(value * 10) / 10} placeholder="auto"
        aria-label={label} onChange={(e) => { const v = parseFloat((e.target as HTMLInputElement).value); if (!Number.isNaN(v)) onChange(v); }} />
      {unit && <i>{unit}</i>}
    </span>
  );
  return prefix ? <label class="od-num od-num-prefix">{field}</label> : <label class="od-num"><span>{label}</span>{field}</label>;
}

/** A colour field: a swatch and its value; opens the palette. */
function Colour({ label, value, deck, onPick, onClear }: {
  label: string; value: string | null; deck: string[]; onPick: (c: string) => void; onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    addEventListener("pointerdown", away);
    return () => removeEventListener("pointerdown", away);
  }, [open]);
  const pick = (c: string) => { onPick(c); setOpen(false); };
  return (
    <div class="od-num od-colour" ref={ref}>
      <span>{label}</span>
      <span class="od-colour-ctl">
        <button class="od-swatch-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span class={`od-chip${value ? "" : " none"}`} style={value ? { background: value } : undefined} />
          <code>{value ?? "None"}</code>
        </button>
        {onClear && value && <button class="od-clear" aria-label={`No ${label.toLowerCase()}`} data-tip={`No ${label.toLowerCase()}`}
          onClick={onClear}><Icon name="close" size={12} /></button>}
      </span>
      {open && <Palette deck={deck} value={value} onPick={pick} />}
    </div>
  );
}

function Select({ label, value, options, onChange }: {
  label: string; value: string; options: [string, string][]; onChange: (v: string) => void;
}) {
  return (
    <label class="od-num"><span>{label}</span>
      <span class="od-select">
        <select value={value} aria-label={label} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
          {options.map(([v, l]) => <option value={v}>{l}</option>)}
        </select>
        <Icon name="down" size={12} />
      </span>
    </label>
  );
}

function Segmented({ label, value, options, onChange }: {
  label: string; value: string; options: [string, string][]; onChange: (v: string) => void;
}) {
  return (
    <div class="od-num"><span>{label}</span>
      <span class="od-seg" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button role="radio" aria-checked={value === v} class={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>
        ))}
      </span>
    </div>
  );
}

function Section({ title, children }: { title?: string; children: ComponentChildren }) {
  return <section class="od-section">{title && <h4>{title}</h4>}{children}</section>;
}

function Head({ icon, title, sub }: { icon: IconName; title: string; sub?: string }) {
  return (
    <header class="od-insp-head">
      <span class="od-insp-icon"><Icon name={icon} size={16} /></span>
      <h3>{title}</h3>
      {sub && <span class="od-insp-sub">{sub}</span>}
    </header>
  );
}

const TYPES: Record<string, [string, IconName]> = { text: ["Text", "text"], math: ["Maths", "sigma"], image: ["Image", "image"],
  shape: ["Shape", "shape"], line: ["Line", "line"], drawing: ["Drawing", "pen"], group: ["Group", "group"] };

const TIPS: [string, string][] = [["Double-click", "edit text or maths"], ["Drop or paste", "add an image"],
  ["Shift-click", "select several"], ["Ctrl+G", "group"], ["Ctrl+D", "duplicate"], ["Ctrl+S", "record a version"]];

export function Inspector({ editor, onEditHtml }: { editor: Editor; onEditHtml: () => void }) {
  const sel = editor.selection.value;
  const deck = useMemo(() => deckColours(serializeDoc(editor.doc.value)), [editor.doc.value]);
  const block = sel.length === 1 && editor.slide ? findBlock(editor.slide, sel[0]) : undefined;

  if (!block && editor.tool.value === "pen") {
    const pen = editor.pen.value;
    return (
      <div class="od-inspector" aria-label="Pen">
        <Head icon="pen" title="Pen" />
        <Section>
          <Colour label="Colour" value={pen.colour} deck={deck} onPick={(c) => (editor.pen.value = { ...pen, colour: c })} />
          <Num label="Thickness" unit="px" value={pen.size} onChange={(v) => (editor.pen.value = { ...pen, size: Math.max(1, v) })} />
        </Section>
        <p class="od-hint">Draw on the slide. Each stroke becomes a drawing you can move. Esc puts the pen down.</p>
      </div>
    );
  }
  if (!block) {
    const slide = editor.slide;
    const bg = slide?.attrs.find(([k]) => k === "data-background-color")?.[1] ?? null;
    const setBg = (v: string | null) => editor.edit("Background", (doc) => setSlideAttr(doc.slides[editor.current.value], "data-background-color", v), "bg");
    if (sel.length > 1) {
      return (
        <div class="od-inspector" aria-label="Selection">
          <Head icon="group" title={`${sel.length} blocks`} />
          <Section>
            <button class="od-btn wide" onClick={() => { let g: string | null = null;
              editor.edit("Group", (doc) => { g = groupBlocks(doc.slides[editor.current.value], sel); });
              if (g) editor.selection.value = [g]; }}><Icon name="group" size={16} />Group them<kbd>Ctrl+G</kbd></button>
          </Section>
        </div>
      );
    }
    return (
      <div class="od-inspector" aria-label="Slide">
        <Head icon="layers" title={`Slide ${editor.current.value + 1}`} sub={`of ${editor.doc.value.slides.length}`} />
        <Section title="Background">
          <Colour label="Colour" value={bg} deck={deck} onPick={setBg} onClear={() => setBg(null)} />
        </Section>
        <Section title="Source">
          <button class="od-btn wide" onClick={onEditHtml}><Icon name="code" size={16} />Edit the slide's HTML<kbd>Alt+Shift+H</kbd></button>
        </Section>
        <dl class="od-tips">
          {TIPS.map(([k, v]) => <div><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>)}
        </dl>
      </div>
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
  const [title, icon] = TYPES[block.type] ?? [block.type, "shape"];

  return (
    <div class="od-inspector" aria-label={title}>
      <Head icon={icon} title={title} />

      {block.type === "text" && (
        <Section title="Text">
          <Select label="Font" value={font ?? ""} options={[["", "Deck default"], ...FONTS.map((f) => [f.css, f.label] as [string, string])]}
            onChange={(v) => change("Font", (b) => setStyle(b.content, "font-family", v || null))} />
          <Colour label="Colour" value={textColour} deck={deck}
            onPick={(c) => change("Text colour", (b) => setStyle(b.content, "color", c))}
            onClear={() => change("Text colour", (b) => setStyle(b.content, "color", null))} />
          <Num label="Size" unit="%" value={contentScale(block)} step={5}
            onChange={(v) => change("Text size", (b) => setContentScale(b, v), `scale-${id}`)} />
          <p class="od-hint">For the whole block. To style part of the text, double-click it and use the toolbar.</p>
        </Section>
      )}

      {block.type === "math" && (
        <Section title="LaTeX">
          <textarea class="od-tex" rows={5} spellcheck={false} value={mathTex(block)} placeholder="\int_0^\infty e^{-x^2}\,dx"
            onInput={(e) => change("Edit maths", (b) => setMathTex(b, (e.target as HTMLTextAreaElement).value), `tex-${id}`)} />
          <label class="od-check">
            <input type="checkbox" checked={attr(block.content, "data-math-display") === "true"}
              onChange={(e) => change("Display mode", (b) => setAttr(b.content, "data-math-display",
                (e.target as HTMLInputElement).checked ? "true" : "false"))} />
            <span class="od-switch" aria-hidden="true" />
            <span>Display style<small>Larger fractions, sums and integrals</small></span>
          </label>
          <Num label="Size" unit="%" value={contentScale(block)} step={5} onChange={(v) => change("Size", (b) => setContentScale(b, v), `scale-${id}`)} />
          <Colour label="Colour" value={textColour} deck={deck}
            onPick={(c) => change("Colour", (b) => setStyle(b.content, "color", c))}
            onClear={() => change("Colour", (b) => setStyle(b.content, "color", null))} />
        </Section>
      )}

      {block.type === "shape" && (() => {
        const sh = shapeSpec(block);
        const symbol = sh.type.startsWith("symbol-");
        const transparent = /rgba\(.*,\s*0\)$/.test(sh.fill);
        return (
          <Section title="Shape">
            {!symbol && <Select label="Kind" value={sh.type} options={SHAPES as [string, string][]}
              onChange={(v) => change("Shape", (b) => setShape(b, { type: v }))} />}
            <Colour label="Fill" value={transparent ? null : sh.fill} deck={deck}
              onPick={(c) => change("Fill", (b) => setShape(b, { fill: c }))}
              onClear={symbol ? undefined : () => change("Fill", (b) => setShape(b, { fill: "rgba(0, 0, 0, 0)" }))} />
            {!symbol && <>
              <Colour label="Border" value={sh.stroke && sh.strokeWidth > 0 ? sh.stroke : null} deck={deck}
                onPick={(c) => change("Border", (b) => setShape(b, { stroke: c, strokeWidth: sh.strokeWidth || 2 }))}
                onClear={() => change("Border", (b) => setShape(b, { stroke: null, strokeWidth: 0 }))} />
              {sh.stroke && sh.strokeWidth > 0 && (
                <Num label="Border width" unit="px" value={sh.strokeWidth}
                  onChange={(v) => change("Border", (b) => setShape(b, { strokeWidth: Math.max(0, v) }))} />
              )}
              {sh.type === "rect" && (
                <Num label="Corners" unit="px" value={sh.radius}
                  onChange={(v) => change("Corners", (b) => setShape(b, { radius: Math.max(0, v) }), `radius-${id}`)} />
              )}
            </>}
          </Section>
        );
      })()}

      {block.type === "line" && (() => {
        const ls = lineSpec(block);
        const upd = (patch: Parameters<typeof setLine>[3], key?: string) =>
          change("Line", (b) => { const e = lineEnds(b); setLine(b, e.p1, e.p2, patch); }, key);
        const caps: [string, string][] = [["none", "None"], ["line-arrow", "Open arrow"], ["arrow", "Filled arrow"]];
        return (
          <Section title="Line">
            <Colour label="Colour" value={ls.color} deck={deck} onPick={(c) => upd({ color: c })} />
            <Num label="Width" unit="px" value={ls.width} onChange={(v) => upd({ width: Math.max(1, v) })} />
            <Select label="Start" value={ls.start} options={caps} onChange={(v) => upd({ start: v })} />
            <Select label="End" value={ls.end} options={caps} onChange={(v) => upd({ end: v })} />
            <Segmented label="Style" value={ls.style === "dashed" ? "dashed" : "solid-rounded"}
              options={[["solid-rounded", "Solid"], ["dashed", "Dashed"]]} onChange={(v) => upd({ style: v })} />
          </Section>
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
          <Section title="Crop, in % of the image">
            <div class="od-grid2">
              <Num prefix label="L" value={pct(trim.left)} unit="%" onChange={(v) => setTrim("left", v)} />
              <Num prefix label="R" value={pct(trim.right)} unit="%" onChange={(v) => setTrim("right", v)} />
              <Num prefix label="T" value={pct(trim.top)} unit="%" onChange={(v) => setTrim("top", v)} />
              <Num prefix label="B" value={pct(trim.bottom)} unit="%" onChange={(v) => setTrim("bottom", v)} />
            </div>
            {cropped ? <button class="od-btn wide" onClick={() => change("Remove crop", (b) => setImageCrop(b, { x: 0, y: 0, width: 1, height: 1 }))}>Remove crop</button> : null}
          </Section>
        );
      })()}

      {block.type === "drawing" && (() => {
        const tpl = document.createElement("template");
        tpl.innerHTML = block.inner;
        const current = tpl.content.querySelector("path")?.getAttribute("fill") ?? "#000000";
        return (
          <Section title="Ink">
            <Colour label="Colour" value={current} deck={deck} onPick={(c) => change("Colour", (b) => {
              const t = document.createElement("template");
              t.innerHTML = b.inner;
              t.content.querySelectorAll("path").forEach((el) => el.setAttribute("fill", c));
              b.inner = t.innerHTML;
            })} />
          </Section>
        );
      })()}

      {block.type === "group" && (
        <Section>
          <button class="od-btn wide" onClick={() => { let kids: string[] = [];
            editor.edit("Ungroup", (doc) => { kids = ungroupBlock(doc.slides[editor.current.value], id); });
            editor.selection.value = kids; }}><Icon name="group" size={16} />Ungroup<kbd>Ctrl+Shift+G</kbd></button>
        </Section>
      )}

      {block.type !== "group" && block.type !== "line" && (
        <Section title="Layout">
          <div class="od-grid2">
            <Num prefix label="X" value={fr.left} onChange={(v) => change("Move", (b) => setFrame(b, { left: v }))} />
            <Num prefix label="Y" value={fr.top} onChange={(v) => change("Move", (b) => setFrame(b, { top: v }))} />
            <Num prefix label="W" value={fr.width} onChange={(v) => change("Resize", (b) => setFrame(b, { width: v }))} />
            <Num prefix label="H" value={fr.height} onChange={(v) => change("Resize", (b) => setFrame(b, { height: v }))} />
          </div>
          <Num label="Rotation" unit="°" value={rotation(block)} onChange={(v) => change("Rotate", (b) => setRotation(b, v))} />
          <Num label="Opacity" unit="%" value={opacity(block)} step={5} onChange={(v) => change("Opacity", (b) => setOpacity(b, v), `opacity-${id}`)} />
        </Section>
      )}
    </div>
  );
}
