// The deck document model. It stays close to the saved HTML on purpose: every attribute and
// style declaration is kept in order, unknown ones included, so loading and saving a deck
// loses nothing. Typed accessors (frame, z-index, rotation…) live in ./block.ts.

/** An attribute or a style declaration: [name, value], original order kept. */
export type Pair = [string, string];

/** An element without its children: tag plus attributes (style and class included, as raw strings). */
export interface Shell {
  tag: string;
  attrs: Pair[];
}

export interface Block {
  /** data-block-id */
  id: string;
  /** data-block-type: text, math, image, shape, line, drawing, group, … */
  type: string;
  /** the .sl-block element: position and size live in its style */
  outer: Shell;
  /** the optional .sl-block-style wrapper (rotation, opacity, shadow, blend) */
  wrapper: Shell | null;
  /** the .sl-block-content element */
  content: Shell;
  /** inner HTML of the content, kept verbatim (all types except group) */
  inner: string;
  /** group blocks: the blocks (and anything else) inside the content */
  children: Item[] | null;
  /** other children of .sl-block after the content, kept verbatim */
  extras: string;
}

export type Item = { kind: "block"; block: Block } | { kind: "raw"; html: string };

export interface Slide {
  /** data-id of the <section> */
  id: string;
  /** attributes of the <section> */
  attrs: Pair[];
  items: Item[];
  /** the exact text of this <section> as loaded; written back as is while `dirty` is false */
  source: string;
  dirty: boolean;
  /** whitespace that preceded this section in the file */
  before: string;
}

export interface Doc {
  slides: Slide[];
  /** whitespace after the last section */
  tail: string;
}
