// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE PULSE  — SAM's own runtime metrics, strictly on-device.
//
//  A tiny in-process registry so SAM can see itself: counters (monotonic totals), gauges (latest
//  value), and histograms (distributions → p50/p95). It auto-instruments SAM's own components; the
//  user configures nothing. Cheap by design — O(1) record, no timers, bounded memory — so watching
//  never costs more than a sliver of CPU. Read by the watchdog (threshold rules) and the status
//  surface. NEVER transmitted: there is no transport. Honors the kill switch SAM_PULSE=0.
// ─────────────────────────────────────────────────────────────

type Labels = Record<string, string>;

const ON = () => process.env.SAM_PULSE !== "0";
const MAX_SERIES = 256;   // hard cap on distinct name+labels combinations — guards cardinality
const HIST_SAMPLES = 256; // bounded recent-values ring per histogram, for percentiles

type Counter = { kind: "counter"; value: number };
type Gauge = { kind: "gauge"; value: number; at: number };
type Hist = { kind: "histogram"; samples: number[]; count: number; sum: number };
type Series = Counter | Gauge | Hist;

const series = new Map<string, Series>();

// Series key = name plus its labels in a stable order. Low cardinality is the caller's job; we ALSO
// enforce it: past MAX_SERIES, a new combination collapses into "<name>|__over__" rather than growing
// unbounded (a metric that silently stops being useful is better than one that eats memory).
function keyOf(name: string, labels?: Labels): string {
  const l = labels ? Object.keys(labels).sort().map((k) => `${k}=${labels[k]}`).join(",") : "";
  const key = l ? `${name}|${l}` : name;
  if (!series.has(key) && series.size >= MAX_SERIES) return `${name}|__over__`;
  return key;
}

/** Add to a monotonic counter (e.g. brain calls, cache hits). */
export function count(name: string, by = 1, labels?: Labels): void {
  if (!ON()) return;
  const key = keyOf(name, labels);
  const s = series.get(key);
  if (s && s.kind === "counter") s.value += by;
  else series.set(key, { kind: "counter", value: by });
}

/** Set a point-in-time gauge (e.g. resident memory, open Breakers). */
export function gauge(name: string, value: number, labels?: Labels): void {
  if (!ON()) return;
  series.set(keyOf(name, labels), { kind: "gauge", value, at: Date.now() });
}

/** Record one observation into a histogram (e.g. brain latency ms). */
export function observe(name: string, value: number, labels?: Labels): void {
  if (!ON()) return;
  const key = keyOf(name, labels);
  const s = series.get(key);
  if (s && s.kind === "histogram") {
    s.samples.push(value); s.count++; s.sum += value;
    if (s.samples.length > HIST_SAMPLES) s.samples.shift();
  } else {
    series.set(key, { kind: "histogram", samples: [value], count: 1, sum: value });
  }
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

export interface MetricView {
  name: string; labels: string; kind: Series["kind"];
  value?: number;                              // counter / gauge
  count?: number; avg?: number; p50?: number; p95?: number; // histogram
}

/** Full readout — counters/gauges by value, histograms with count + avg + p50/p95. Computed on read. */
export function snapshot(): MetricView[] {
  const out: MetricView[] = [];
  for (const [key, s] of series) {
    const [name, labels = ""] = key.split("|");
    if (s.kind === "histogram") {
      const sorted = [...s.samples].sort((a, b) => a - b);
      out.push({ name, labels, kind: s.kind, count: s.count, avg: s.count ? s.sum / s.count : 0, p50: pct(sorted, 50), p95: pct(sorted, 95) });
    } else {
      out.push({ name, labels, kind: s.kind, value: s.value });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.labels.localeCompare(b.labels));
}

/** Compact summary for the status/doctor surface — a few headline numbers, cheap. */
export function pulseSummary(): { series: number; brainCalls: number; brainFailures: number; cacheHitRate: number | null } {
  const val = (name: string) => snapshot().filter((m) => m.name === name).reduce((n, m) => n + (m.value ?? 0), 0);
  const hits = val("index.cache.hit");
  const misses = val("index.cache.miss");
  const total = hits + misses;
  return {
    series: series.size,
    brainCalls: val("brain.calls"),
    brainFailures: val("brain.failures"),
    cacheHitRate: total ? Math.round((hits / total) * 100) / 100 : null,
  };
}

/** Recent raw observations for a histogram (the bounded ring) — for sparklines. Empty if not a
 *  histogram or unseen. */
export function samplesOf(name: string, labels?: Labels): number[] {
  const s = series.get(keyOf(name, labels));
  return s && s.kind === "histogram" ? [...s.samples] : [];
}

/** Test/maintenance helper — clear the registry. */
export function _reset(): void { series.clear(); }
