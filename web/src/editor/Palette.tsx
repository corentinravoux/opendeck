// The colour picker of the inspector and the text toolbar: the deck's own colours first,
// then basic colours, then any colour (system picker or a hex value).
import { useState } from "preact/hooks";
import { BASIC_COLOURS } from "./fonts";

/** `keepFocus` keeps the text selection while picking (text toolbar). */
export function Palette({ deck, value, onPick, keepFocus = false }: {
  deck: string[]; value?: string | null; onPick: (c: string) => void; keepFocus?: boolean;
}) {
  const [hex, setHex] = useState(value ?? "");
  const swatch = (c: string) => (
    <button title={c} aria-label={c} class={value?.toLowerCase() === c ? "on" : ""} style={{ background: c }} onClick={() => onPick(c)} />
  );
  return (
    <div class="od-palette od-pop" onMouseDown={(e) => { if (keepFocus && (e.target as HTMLElement).tagName !== "INPUT") e.preventDefault(); }}>
      {deck.length > 0 && <>
        <h4>In this deck</h4>
        <div class="od-swatches">{deck.map(swatch)}</div>
      </>}
      <h4>Basic</h4>
      <div class="od-swatches">{BASIC_COLOURS.map(swatch)}</div>
      <div class="od-palette-custom">
        <input type="color" aria-label="Pick any colour" value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#000000"}
          onChange={(e) => onPick((e.target as HTMLInputElement).value)} />
        <input class="od-hex" value={hex} placeholder="#1155cc" aria-label="Hex colour" spellcheck={false}
          onInput={(e) => setHex((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === "Enter" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim())) onPick(hex.trim().toLowerCase()); }} />
      </div>
    </div>
  );
}

