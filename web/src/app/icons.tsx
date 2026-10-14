// A small icon set for the editor chrome: 20 px, 1.6 px strokes, currentColor.
import type { JSX } from "preact";

const P: Record<string, JSX.Element> = {
  home: <><path d="M3.5 9.5 10 4l6.5 5.5" /><path d="M5.5 8.5V16h9V8.5" /></>,
  undo: <><path d="M7 5 3.5 8.5 7 12" /><path d="M3.5 8.5H12a4.5 4.5 0 0 1 0 9H9" /></>,
  redo: <><path d="m13 5 3.5 3.5L13 12" /><path d="M16.5 8.5H8a4.5 4.5 0 0 0 0 9h3" /></>,
  check: <path d="m4.5 10.5 3.5 3.5 7.5-8" />,
  dot: <circle cx="10" cy="10" r="3" fill="currentColor" stroke="none" />,
  export: <><path d="M10 3.5v9" /><path d="m6.5 9 3.5 3.5L13.5 9" /><path d="M4 14.5v2h12v-2" /></>,
  play: <path d="M7 4.5v11l9-5.5z" />,
  layers: <><path d="m10 3.5 7 3.5-7 3.5L3 7z" /><path d="m3 10.5 7 3.5 7-3.5" /><path d="m3 14 7 3.5 7-3.5" /></>,
  text: <><path d="M4.5 5h11" /><path d="M10 5v11" /><path d="M8 16h4" /></>,
  sigma: <path d="M15 4.5H5.5l5 5.5-5 5.5H15" />,
  shape: <rect x="4" y="5" width="12" height="10" rx="1" />,
  line: <path d="M4.5 15.5 15.5 4.5" />,
  arrow: <><path d="M4.5 15.5 15.5 4.5" /><path d="M9 4.5h6.5V11" /></>,
  image: <><rect x="3.5" y="4.5" width="13" height="11" rx="1" /><circle cx="7.5" cy="8.5" r="1.3" /><path d="m4 14.5 4-4 3 3 2-2 3.5 3.5" /></>,
  pen: <><path d="M4 16l1-4 8.5-8.5 3 3L8 15z" /><path d="m11.5 5.5 3 3" /></>,
  plus: <><path d="M10 4.5v11" /><path d="M4.5 10h11" /></>,
  copy: <><rect x="7" y="7" width="9" height="9" rx="1" /><path d="M13 4H5a1 1 0 0 0-1 1v8" /></>,
  trash: <><path d="M4.5 6h11" /><path d="M8 6V4.5h4V6" /><path d="M6 6l.8 10h6.4L14 6" /></>,
  history: <><path d="M4 10a6 6 0 1 0 1.8-4.3" /><path d="M4 4.5v3h3" /><path d="M10 7v3.5l2.5 1.5" /></>,
  library: <><rect x="3.5" y="6" width="10" height="9" rx="1" /><path d="M6.5 3.5h10v9" /></>,
  close: <><path d="m5 5 10 10" /><path d="M15 5 5 15" /></>,
  folder: <path d="M3.5 6.5v8.5h13V8H9.5L8 6.5z" />,
  up: <path d="m6 12 4-4 4 4" />,
  down: <path d="m6 8 4 4 4-4" />,
  search: <><circle cx="9" cy="9" r="4.5" /><path d="m12.5 12.5 4 4" /></>,
  group: <><rect x="3.5" y="3.5" width="8" height="8" rx="1" /><rect x="8.5" y="8.5" width="8" height="8" rx="1" /></>,
};

export function Icon({ name, size = 20 }: { name: keyof typeof P; size?: number }) {
  return (
    <svg class="od-icon" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
      stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{P[name]}</svg>
  );
}

export type IconName = keyof typeof P;
