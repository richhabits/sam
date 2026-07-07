import { useEffect } from "react";

// Every overlay (drawer, menu, palette, drop-zone) closes on Escape — a baseline UX guarantee so
// nothing can ever get "stuck open with no way out". Pair with a backdrop click for full coverage.
export function useEscape(onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose, active]);
}
