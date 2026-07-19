// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE SCOPE  — the live, real-time view of what SAM is doing right now.
//
//  Where the Console is an at-a-glance snapshot, the Scope updates every ~1.5s: live latency, the
//  session's token + cost burn, active heals, and a feed of recent activity (brain calls, heals).
//  It reads the in-process Pulse — nothing leaves the machine — and stays cheap: one small poll, no
//  animation loops, no per-frame work. The page carries the ONE inline script in the local views,
//  because "live" is exactly the case that needs it; it still fetches only same-origin, loopback data.
// ─────────────────────────────────────────────────────────────
import { issuesSummary } from "./issues.ts";
import { recentActivity, snapshot, type Activity } from "./pulse.ts";

export interface ScopeData {
  at: number;
  brainCalls: number; failures: number; breakerOpen: number;
  tokens: number; costUsd: number; hitRate: number | null;
  p50: number; p95: number; heals: number; issues: number; rssMb: number;
  activity: Activity[];
}

/** Compact live snapshot from the Pulse. Cheap — a few reductions over the registry. */
export function scopeData(): ScopeData {
  const snap = snapshot();
  const sum = (name: string) => snap.filter((m) => m.name === name).reduce((n, m) => n + (m.value ?? 0), 0);
  const lat = snap.find((m) => m.name === "brain.latency_ms");
  const hits = sum("index.cache.hit");
  const misses = sum("index.cache.miss");
  return {
    at: Date.now(),
    brainCalls: sum("brain.calls"),
    failures: sum("brain.failures"),
    breakerOpen: sum("breaker.open"),
    tokens: sum("brain.tokens"),
    costUsd: sum("brain.cost_micro") / 1e6,
    hitRate: hits + misses ? hits / (hits + misses) : null,
    p50: Math.round(lat?.p50 ?? 0),
    p95: Math.round(lat?.p95 ?? 0),
    heals: sum("keeper.heal"),
    issues: issuesSummary().distinct,
    rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    activity: recentActivity(12),
  };
}

/** The live page. Polls /api/scope every ~1.5s and updates the DOM. Self-contained + loopback-only.
 *  Activity labels are written via textContent (never innerHTML), so the feed can't inject markup. */
export function renderScope(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SAM · Scope</title><style>
:root{--bg:#faf7f2;--surface:#fff;--text:#1c1712;--muted:#8a8178;--border:#e7e0d6;--accent:#e8673a;--ok:#22a06b;--warn:#c9820b;--bad:#e04a4a}
@media(prefers-color-scheme:dark){:root{--bg:#100e0c;--surface:#1c1712;--text:#f3ede4;--muted:#9a9187;--border:#2a231c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,sans-serif;padding:24px}
h1{font-size:18px;margin:0 0 2px}.sub{color:var(--muted);font-size:13px;margin-bottom:20px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ok);margin-right:6px;animation:p 1.5s ease-in-out infinite}
@keyframes p{0%,100%{opacity:1}50%{opacity:.3}}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:24px}
.tile{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 16px}
.tile .v{font-size:24px;font-weight:700;letter-spacing:-.02em}.tile .l{color:var(--muted);font-size:12px;margin-top:2px}
.tile.warn .v{color:var(--warn)}.tile.bad .v{color:var(--bad)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px}
.card h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 10px}
.feed div{display:flex;gap:10px;padding:5px 0;border-top:1px solid var(--border);font-size:13px}
.feed .k{color:var(--accent);font-weight:600;min-width:44px}.feed .t{color:var(--muted);margin-left:auto;font-variant-numeric:tabular-nums}
</style></head><body>
<h1><span class="dot"></span>SAM · Scope</h1><div class="sub">Live · updates every 1.5s · on-device only</div>
<div class="tiles">
  <div class="tile"><div class="v" id="calls">–</div><div class="l">Brain calls</div></div>
  <div class="tile" id="failT"><div class="v" id="fails">–</div><div class="l">Failures</div></div>
  <div class="tile"><div class="v" id="lat">–</div><div class="l">Latency p50 / p95</div></div>
  <div class="tile"><div class="v" id="tokens">–</div><div class="l">Tokens (session)</div></div>
  <div class="tile"><div class="v" id="cost">–</div><div class="l">Cost (session)</div></div>
  <div class="tile"><div class="v" id="heals">–</div><div class="l">Heals</div></div>
  <div class="tile"><div class="v" id="rss">–</div><div class="l">Memory</div></div>
  <div class="tile" id="issT"><div class="v" id="issues">–</div><div class="l">Issues</div></div>
</div>
<div class="card"><h2>Live activity</h2><div class="feed" id="feed"></div></div>
<script>
const H = {};
const t = (window.samDesktop && window.samDesktop.controlToken) || "";
if (t) H["X-SAM-Token"] = t;
const set = (id, v) => { document.getElementById(id).textContent = v; };
const fmt = (n) => n >= 1000 ? (n/1000).toFixed(n>=10000?0:1)+"k" : String(n);
async function poll() {
  let d; try { d = await (await fetch("/api/scope", { headers: H })).json(); } catch (e) { return; }
  set("calls", fmt(d.brainCalls)); set("fails", fmt(d.failures));
  set("lat", d.p50 + " / " + d.p95 + " ms"); set("tokens", fmt(d.tokens));
  set("cost", "$" + d.costUsd.toFixed(4)); set("heals", fmt(d.heals));
  set("rss", d.rssMb + " MB"); set("issues", fmt(d.issues));
  document.getElementById("failT").className = "tile" + (d.failures ? " warn" : "");
  document.getElementById("issT").className = "tile" + (d.issues ? " warn" : "");
  const feed = document.getElementById("feed"); feed.innerHTML = "";
  for (const a of d.activity) {
    const row = document.createElement("div");
    const k = document.createElement("span"); k.className = "k"; k.textContent = a.kind;
    const l = document.createElement("span"); l.textContent = a.label;               // textContent → no injection
    const tm = document.createElement("span"); tm.className = "t"; tm.textContent = new Date(a.at).toLocaleTimeString();
    row.append(k, l, tm); feed.appendChild(row);
  }
}
poll(); setInterval(poll, 1500);
</script></body></html>`;
}
