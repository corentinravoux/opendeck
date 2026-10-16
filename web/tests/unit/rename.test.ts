// Renaming a deck from the editor: no edit is accepted between the save that precedes the rename
// and the reopening of the deck under its new name (it would be lost), and a failed rename gives
// the document back.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Deck, DeckMeta } from "../../src/app/api";
import { Editor } from "../../src/editor/store";

const SLIDES = `<section data-id="s1"></section>`;

function editor(): Editor {
  return new Editor({ name: "2026-10_old", meta: { title: "Old" } as DeckMeta, slides: SLIDES, etag: "e0" } as Deck);
}

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("rename", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuses edits while the rename is under way, and after it", async () => {
    let finish!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
      if (init.method === "PUT") return Promise.resolve(respond({ etag: "e1", committed: false }));
      return new Promise<Response>((resolve) => { finish = resolve; });
    }));
    const ed = editor();
    ed.edit("touch", (d) => { d.tail = "a"; });
    const renamed = ed.rename("New");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const before = ed.doc.value;
    ed.edit("late", (d) => { d.tail = "b"; });
    ed.undo();
    expect(ed.doc.value).toBe(before);
    finish(respond({ name: "2026-10_new", etag: "e2" }));
    expect(await renamed).toBe("2026-10_new");
    ed.edit("after", (d) => { d.tail = "c"; });
    expect(ed.doc.value).toBe(before);
  });

  it("gives the document back when the rename fails", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) =>
      Promise.resolve(init.method === "PUT" ? respond({ etag: "e1", committed: false }) : respond({ error: "taken" }, 409))));
    const ed = editor();
    await expect(ed.rename("New")).rejects.toThrow();
    ed.edit("again", (d) => { d.tail = "x"; });
    expect(ed.doc.value.tail).toBe("x");
  });
});
