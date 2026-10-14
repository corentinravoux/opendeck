// KaTeX typesetting of math blocks (.math-input -> .math-output) and of inline \( \) in text.
import katex from "katex";
import renderMathInElement from "katex/contrib/auto-render";

const OPTIONS = { throwOnError: false, strict: "ignore" as const, trust: false };

const cache = new Map<string, string>();

export function typeset(tex: string, display: boolean, macros: Record<string, string> = {}): string {
  const key = `${display ? "D" : "I"}\u0000${tex}`;
  let html = cache.get(key);
  if (html === undefined) {
    html = katex.renderToString(tex, { ...OPTIONS, displayMode: display, macros: { ...macros } });
    cache.set(key, html);
  }
  return html;
}

/** Render one math block's content element in place. */
export function renderMathBlock(content: HTMLElement, macros: Record<string, string> = {}): void {
  const input = content.querySelector<HTMLElement>(":scope > .math-input");
  if (!input) return;
  let output = content.querySelector<HTMLElement>(":scope > .math-output");
  if (!output) {
    output = document.createElement("div");
    output.className = "math-output";
    content.insertBefore(output, input);
  }
  output.innerHTML = typeset(input.textContent ?? "", content.dataset.mathDisplay === "true", macros);
}

const INLINE = /\\\(|\\\[|\$\$/;

/** Typeset \( \), \[ \] and $$ $$ inside a text block. */
export function renderInlineMath(content: HTMLElement, macros: Record<string, string> = {}): void {
  if (!INLINE.test(content.textContent ?? "")) return;
  renderMathInElement(content, {
    ...OPTIONS,
    macros: { ...macros },
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false },
    ],
  });
}
