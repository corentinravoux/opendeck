// Light or dark chrome. Follows the system until the user picks one; the choice is remembered
// in this browser only (it is a viewing preference, not part of any deck).
import { signal } from "@preact/signals";

type Theme = "light" | "dark";
const KEY = "opendeck-theme";

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

const system = (): Theme => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

export const theme = signal<Theme>(stored() ?? system());

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
}
apply(theme.value);

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (!stored()) apply((theme.value = system()));
});

export function toggleTheme(): void {
  theme.value = theme.value === "dark" ? "light" : "dark";
  apply(theme.value);
  try {
    localStorage.setItem(KEY, theme.value);
  } catch {
    /* private window: the choice lasts for this session only */
  }
}
