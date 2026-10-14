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
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  health: () => call<Health>("GET", "/api/health"),
  decks: () => call<DeckInfo[]>("GET", "/api/decks"),
  deck: (name: string) => call<Deck>("GET", `/api/decks/${enc(name)}`),
  exports: (name: string) => call<RememberedExport[]>("GET", `/api/decks/${enc(name)}/exports`),
  exportDeck: (name: string, body: { kind: string; dir: string; name: string; zip: boolean; single?: boolean; overwrite: boolean }) =>
    call<{ path: string }>("POST", `/api/decks/${enc(name)}/export`, body),
  pickFolder: (start: string) => call<{ path: string | null }>("POST", "/api/host/pick-folder", { start }),
  reveal: (path: string) => call<{ ok: boolean }>("POST", "/api/host/reveal", { path }),
};

/** URL of a file inside a deck folder, as served by the server. */
export const viewUrl = (deck: string, rel = "") => `/view/${enc(deck)}/${rel}`;
