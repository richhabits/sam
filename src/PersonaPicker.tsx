import { useEffect, useRef, useState } from "react";
import Icon, { type IconName } from "./Icon";

export type PersonaOpt = { id: string; label: string; emoji: string; blurb: string };

/**
 * Who SAM sounds like.
 *
 * Was a native <select> with emoji options. A native select renders in the OS's own chrome —
 * on macOS a dark system menu — so it sat in the middle of a warm cream toolbar looking like it
 * belonged to a different application. It also can't show the blurb that tells you what each
 * voice actually does, which is the whole reason to pick one.
 */
const GLYPH: Record<string, IconName> = {
  sam: "brain",
  pa: "briefcase",
  coach: "trophy",
  gran: "home",
  mum: "people",
  dad: "shield",
  bestie: "sparkle",
  mentor: "markets",
};

export default function PersonaPicker({
  value,
  options,
  onPick,
}: {
  value: string;
  options: PersonaOpt[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.id === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="pp" ref={ref}>
      <button
        type="button"
        className={`pp-btn${open ? " open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Who SAM sounds like — ${current?.blurb ?? ""}. Same memory, different voice.`}
      >
        <Icon name={GLYPH[current?.id] ?? "brain"} size={16} />
        <span className="pp-label">{current?.label}</span>
        <span className="pp-chev" aria-hidden="true">⌄</span>
      </button>

      {open && (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: scrim; Esc and click-out close it */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: scrim; Esc and click-out close it */}
          <div className="pp-scrim" onClick={() => setOpen(false)} />
          <div className="pp-menu" role="menu">
            {options.map((o) => (
              <button
                type="button"
                key={o.id}
                role="menuitemradio"
                aria-checked={o.id === value}
                className={`pp-item${o.id === value ? " on" : ""}`}
                onClick={() => {
                  onPick(o.id);
                  setOpen(false);
                }}
              >
                <Icon name={GLYPH[o.id] ?? "brain"} size={16} />
                <span className="pp-name">{o.label}</span>
                <span className="pp-blurb">{o.blurb}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
