// Small building blocks shared by the chrome: icon buttons, dialogs, menus.
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon, type IconName } from "./icons";
import { theme, toggleTheme } from "./theme";

type ButtonProps = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "icon" | "label">;

/** A square icon button with a tooltip; `label` is its accessible name and tooltip. */
export function IconButton({ icon, label, tip, size = 18, class: cls = "", pressed, ...rest }: ButtonProps & {
  icon: IconName; label: string; tip?: string; size?: number; class?: string; pressed?: boolean;
}) {
  return (
    <button {...rest} type="button" class={`od-ib${pressed ? " on" : ""} ${cls}`} aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed} data-tip={tip ?? label}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function ThemeToggle() {
  const dark = theme.value === "dark";
  return <IconButton icon={dark ? "sun" : "moon"} label={dark ? "Light theme" : "Dark theme"} onClick={toggleTheme} />;
}

/** A modal dialog: Escape or a click on the backdrop closes it (unless `busy`). */
export function Modal({ label, onClose, busy = false, class: cls = "", children }: {
  label: string; onClose: () => void; busy?: boolean; class?: string; children: ComponentChildren;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) { e.stopPropagation(); onClose(); }
    };
    addEventListener("keydown", onKey, true);
    const first = box.current?.querySelector<HTMLElement>("[autofocus]")
      ?? box.current?.querySelector<HTMLElement>("button.primary:not(:disabled), input[type=text], input:not([type]), textarea");
    first?.focus();
    return () => removeEventListener("keydown", onKey, true);
  }, [busy]);
  return (
    <div class="od-modal-back" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div class={`od-modal ${cls}`} role="dialog" aria-modal="true" aria-label={label} ref={box}>{children}</div>
    </div>
  );
}

export function ModalHead({ title, sub, onClose }: { title: ComponentChildren; sub?: ComponentChildren; onClose: () => void }) {
  return (
    <header class="od-modal-head">
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      <IconButton icon="close" label="Close" onClick={onClose} />
    </header>
  );
}

export interface MenuItem { label: string; icon: IconName; run: () => void; kbd?: string; danger?: boolean }

/** A button that opens a short list of actions. */
export function Menu({ icon = "dots", label, items }: { icon?: IconName; label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc);
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => { removeEventListener("pointerdown", away); removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div class="od-menu-wrap" ref={ref}>
      <IconButton icon={icon} label={label} pressed={open} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div class="od-menu od-pop" role="menu">
          {items.map((it) => (
            <button type="button" role="menuitem" class={it.danger ? "danger" : ""} onClick={() => { setOpen(false); it.run(); }}>
              <Icon name={it.icon} size={16} />
              <span>{it.label}</span>
              {it.kbd && <kbd>{it.kbd}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
