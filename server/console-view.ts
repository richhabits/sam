// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE CONSOLE  — a single, self-contained, strictly-local status page.
//
//  Renders the Pulse (SAM's own metrics) and the Black Box (recent issues) as one HTML view: stat
//  tiles for the headline numbers, a sparkline of recent brain latency, and the issue list. Every
//  byte is baked in server-side — no external fetch, no scripts, no fonts, no phone-home. Threshold
//  colours flag what's off. The live-updating view is the Scope; this is the at-a-glance snapshot.
// ─────────────────────────────────────────────────────────────
import type { Issue } from "./issues.ts";
import type { Influence } from "./knack.ts";
import type { MetricView } from "./pulse.ts";

type Tone = "ok" | "warn" | "bad" | "muted";
interface Tile { label: string; value: string; tone: Tone }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

export interface KnackView { enabled: boolean; recent: Influence[] }

/** Build the Console page from a snapshot. Pure — no I/O, so it's directly testable. `knack` is
 *  defaulted so older callers/tests keep working; the route passes the live influence log. */
export function renderConsole(pulse: MetricView[], issues: Issue[], latencySamples: number[], nowIso: string, knack: KnackView = { enabled: false, recent: [] }): string {
  const sum = (name: string) => pulse.filter((m) => m.name === name).reduce((n, m) => n + (m.value ?? 0), 0);
  const failures = sum("brain.failures");
  const breakerOpen = sum("breaker.open");
  const hits = sum("index.cache.hit");
  const misses = sum("index.cache.miss");
  const hitRate = hits + misses ? hits / (hits + misses) : null;
  const lat = pulse.find((m) => m.name === "brain.latency_ms");
  const p50 = Math.round(lat?.p50 ?? 0);
  const p95 = Math.round(lat?.p95 ?? 0);

  const tiles: Tile[] = [
    { label: "Brain calls", value: fmt(sum("brain.calls")), tone: "ok" },
    { label: "Failures", value: fmt(failures), tone: failures > 0 ? "warn" : "ok" },
    { label: "Breaker trips", value: fmt(breakerOpen), tone: breakerOpen > 0 ? "bad" : "ok" },
    { label: "Tokens", value: fmt(sum("brain.tokens")), tone: "muted" },
    { label: "Cache hit-rate", value: hitRate === null ? "—" : `${Math.round(hitRate * 100)}%`, tone: hitRate === null ? "muted" : hitRate < 0.5 ? "warn" : "ok" },
    { label: "Latency p50 / p95", value: `${p50} / ${p95} ms`, tone: p95 > 8000 ? "warn" : "ok" },
    { label: "Issues", value: fmt(issues.length), tone: issues.length > 0 ? "warn" : "ok" },
    { label: "Knack applied", value: knack.enabled ? fmt(sum("knack.applied")) : "off", tone: "muted" },
  ];

  const tileHtml = tiles.map((t) => `<div class="tile ${t.tone}"><div class="v">${esc(t.value)}</div><div class="l">${esc(t.label)}</div></div>`).join("");
  const spark = sparkline(latencySamples);
  const issueHtml = issues.length
    ? issues.slice(0, 12).map((i) => `<tr><td class="msg">${esc(i.message)}</td><td class="n">${i.count}×</td><td class="at">${esc(i.lastAt.slice(11, 19))}</td></tr>`).join("")
    : `<tr><td colspan="3" class="clear">All clear — nothing captured.</td></tr>`;

  // The Knack — every learned pattern that changed a decision, attributed. Off is shown explicitly:
  // radical transparency means the user can see whether anything learned is influencing SAM at all.
  const knackHtml = !knack.enabled
    ? `<tr><td colspan="3" class="note">The Knack is off — no learned pattern is influencing decisions.</td></tr>`
    : knack.recent.length
      ? knack.recent.slice(-12).reverse().map((k) => `<tr><td class="msg">${esc(k.pattern)} → ${esc(k.value)}</td><td class="n">${k.confidence.toFixed(2)}</td><td class="at">${esc(k.at.slice(11, 19))}</td></tr>`).join("")
      : `<tr><td colspan="3" class="note">On — no learned pattern has changed a decision yet.</td></tr>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SAM · Console</title><style>
:root{--bg:#faf7f2;--surface:#fff;--text:#1c1712;--muted:#8a8178;--border:#e7e0d6;--accent:#e8673a;--ok:#22a06b;--warn:#c9820b;--bad:#e04a4a}
@media(prefers-color-scheme:dark){:root{--bg:#100e0c;--surface:#1c1712;--text:#f3ede4;--muted:#9a9187;--border:#2a231c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,sans-serif;padding:24px}
h1{font-size:18px;margin:0 0 2px}.sub{color:var(--muted);font-size:13px;margin-bottom:20px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:24px}
.tile{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 16px}
.tile .v{font-size:26px;font-weight:700;letter-spacing:-.02em}.tile .l{color:var(--muted);font-size:12px;margin-top:2px}
.tile.ok .v{color:var(--ok)}.tile.warn .v{color:var(--warn)}.tile.bad .v{color:var(--bad)}.tile.muted .v{color:var(--text)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:16px}
.card h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 10px}
table{width:100%;border-collapse:collapse;font-size:13px}td{padding:6px 4px;border-top:1px solid var(--border);vertical-align:top}
td.msg{width:100%}td.n{color:var(--muted);white-space:nowrap;text-align:right}td.at{color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
td.clear{color:var(--ok);text-align:center;border:0}td.note{color:var(--muted);text-align:center;border:0}
svg{width:100%;height:48px;display:block}.spark path{fill:none;stroke:var(--accent);stroke-width:2}
</style></head><body>
<h1>SAM · Console</h1><div class="sub">Local self-observability · ${esc(nowIso.slice(0, 19).replace("T", " "))} · reads on-device only, nothing leaves this machine</div>
<div class="tiles">${tileHtml}</div>
<div class="card"><h2>Brain latency (recent)</h2>${spark}</div>
<div class="card"><h2>The Black Box — recent issues</h2><table><tbody>${issueHtml}</tbody></table></div>
<div class="card"><h2>The Knack — learned influence</h2><table><tbody>${knackHtml}</tbody></table></div>
</body></html>`;
}

// A dependency-free SVG sparkline. Empty state renders a flat baseline rather than nothing.
function sparkline(samples: number[]): string {
  if (samples.length < 2) return `<div class="spark"><svg viewBox="0 0 100 24" preserveAspectRatio="none"><path d="M0 22 L100 22"/></svg></div>`;
  const w = 100;
  const h = 24;
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const span = max - min || 1;
  const step = w / (samples.length - 1);
  const pts = samples.map((v, i) => `${(i * step).toFixed(1)} ${(h - 1 - ((v - min) / span) * (h - 2)).toFixed(1)}`);
  return `<div class="spark"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="M${pts.join(" L")}"/></svg></div>`;
}
