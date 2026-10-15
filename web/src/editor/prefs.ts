// Editor preferences: viewing choices of this browser, not part of any deck. Remembered like the
// theme (app/theme.ts), in localStorage; a private window keeps them for the session only.
import { signal } from "@preact/signals";

const SNAP_KEY = "opendeck-snap";

function storedSnap(): boolean {
  try {
    return localStorage.getItem(SNAP_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Snap moved and resized blocks to alignment guides (on by default; Alt suspends it per drag). */
export const snapGuides = signal(storedSnap());

export function toggleSnapGuides(): void {
  snapGuides.value = !snapGuides.value;
  try {
    localStorage.setItem(SNAP_KEY, snapGuides.value ? "on" : "off");
  } catch {
    /* private window: the choice lasts for this session only */
  }
}
