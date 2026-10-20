import "katex/dist/katex.min.css";
import "../runtime/fonts.css";
import "../render/base.css";
import "../render/theme/presets.css";
import "./app.css";
import "./theme";

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { DeckList } from "./DeckList";
import { DeckView } from "./DeckView";
import { MirrorCheck } from "./MirrorCheck";

function route(): { deck: string | null } {
  const m = /^#\/deck\/(.+)$/.exec(location.hash);
  return { deck: m ? decodeURIComponent(m[1]) : null };
}

function App() {
  const [r, setR] = useState(route());
  useEffect(() => {
    const onHash = () => setR(route());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  return <>{r.deck ? <DeckView name={r.deck} /> : <DeckList />}<MirrorCheck /></>;
}

render(<App />, document.getElementById("app")!);
