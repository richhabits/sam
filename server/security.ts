// ─────────────────────────────────────────────────────────────
//  S.A.M. · SECURITY WATCHDOG  ("Jeeves on the door")
//  Watches for anything dodgy and logs it — what, where, when —
//  so SAM can call it out: blocked dangerous commands, requests
//  from unexpected origins, repeated failures. Nothing leaves the
//  machine; this is your own in-house guard.
// ─────────────────────────────────────────────────────────────

export type SecLevel = "info" | "warn" | "alert";
export interface SecEvent { at: string; iso: string; level: SecLevel; type: string; detail: string; source?: string }

const EVENTS: SecEvent[] = [];
const MAX = 250;

// Record a security-relevant event. `alert` = someone/something dodgy.
export function logSecurity(level: SecLevel, type: string, detail: string, source?: string) {
  const now = new Date();
  EVENTS.push({
    at: now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    iso: now.toISOString(), level, type, detail: String(detail).slice(0, 300), source,
  });
  if (EVENTS.length > MAX) EVENTS.shift();
  if (level !== "info") console.warn(`  🛡️  [${level.toUpperCase()}] ${type}: ${detail}${source ? ` — from ${source}` : ""}`);
}

export function securityEvents(n = 40): SecEvent[] { return EVENTS.slice(-n).reverse(); }

export function securityStatus() {
  const alerts = EVENTS.filter((e) => e.level === "alert").length;
  const warns = EVENTS.filter((e) => e.level === "warn").length;
  return {
    clear: alerts === 0 && warns === 0,
    alerts, warns, total: EVENTS.length,
    headline: alerts > 0 ? `${alerts} thing${alerts > 1 ? "s" : ""} SAM flagged and blocked`
      : warns > 0 ? `${warns} thing${warns > 1 ? "s" : ""} worth a look` : "All clear — nothing dodgy",
    latest: EVENTS.slice(-6).reverse(),
  };
}
