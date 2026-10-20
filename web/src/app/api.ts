// Calls to the local opendeck server. Mutating requests carry X-Opendeck (see server/app.py).

export interface DeckInfo {
  name: string;
  title: string;
  slides: number;
  width: number;
  height: number;
  modified: string;
  theme_font: string;
  theme_color: string;
  first: string;
  /** only when publishing is configured (publish_remote): whether the deck is published */
  public?: boolean;
}

export interface DeckMeta {
  title: string;
  width: number;
  height: number;
  theme_font: string;
  theme_color: string;
  slide_number: boolean;
  macros: Record<string, string>;
}

export interface Deck {
  name: string;
  meta: DeckMeta;
  slides: string;
  etag: string;
}

export interface RememberedExport {
  kind: "pdf" | "html";
  dir: string;
  name: string;
  zip: boolean;
  at: string;
}

/** Publishing (publish_remote): the public decks, when the site was last pushed, its address. */
export interface Publishing {
  enabled: boolean;
  public?: number;
  last?: string | null;
  site?: string | null;
}

export interface Published {
  snapshot: string;
  decks: number;
  changed: boolean;
  last: string | null;
}

/** The branch the history mirror has checked out: opendeck needs `main`. */
export interface MirrorState {
  branch: string;
  ok: boolean;
  can_switch: boolean;
}

export interface Health {
  version: string;
  decks_root: string;
  export_root: string;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (method !== "GET") (init.headers as Record<string, string>)["X-Opendeck"] = "1";
  if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { error, moved } = data as { error?: string; moved?: string };
    // `moved`: the deck was renamed (by another window); this is its new name
    throw Object.assign(new Error(error ?? `${res.status} ${res.statusText}`), { moved });
  }
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  health: () => call<Health>("GET", "/api/health"),
  decks: () => call<DeckInfo[]>("GET", "/api/decks"),
  deck: (name: string) => call<Deck>("GET", `/api/decks/${enc(name)}`),
  mirror: () => call<MirrorState>("GET", "/api/mirror"),
  switchMirror: () => call<MirrorState>("POST", "/api/mirror/switch"),
  publishing: () => call<Publishing>("GET", "/api/publishing"),
  /** Snapshot the public decks and push them to publish_remote (what `opendeck publish` does). */
  publish: () => call<Published>("POST", "/api/publish"),
  setVisibility: (name: string, isPublic: boolean) =>
    call<{ name: string; public: boolean }>("POST", `/api/decks/${enc(name)}/visibility`, { public: isPublic }),
  /** New title; the folder follows it (YYYY-MM_<slug>). Returns the deck's (new) name. */
  renameDeck: (name: string, title: string) => call<{ name: string; etag: string }>("POST", `/api/decks/${enc(name)}/rename`, { title }),
  exports: (name: string) => call<RememberedExport[]>("GET", `/api/decks/${enc(name)}/exports`),
  exportDeck: (name: string, body: { kind: string; dir: string; name: string; zip: boolean; single?: boolean; overwrite: boolean }) =>
    call<{ path: string }>("POST", `/api/decks/${enc(name)}/export`, body),
  pickFolder: (start: string) => call<{ path: string | null }>("POST", "/api/host/pick-folder", { start }),
  reveal: (path: string) => call<{ ok: boolean }>("POST", "/api/host/reveal", { path }),
};

/** URL of a file inside a deck folder, as served by the server. */
export const viewUrl = (deck: string, rel = "") => `/view/${enc(deck)}/${rel}`;
