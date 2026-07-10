// ─────────────────────────────────────────────────────────────
//  S.A.M. · BENCHMARK HARNESS  (Phase 0 — the proof mechanism)
//
//  Drives a FIXED suite of representative tasks through the REAL
//  request pipeline (routing, tier selection, prompt assembly,
//  agent loop, semantic cache) and records, per task:
//    · latency to first token   · total latency
//    · tokens in / out          · estimated cost
//    · which brain (tier) answered · cache hit?
//
//  Runs against a DETERMINISTIC, OFFLINE mock brain (SAM_BENCH_MOCK=1)
//  so it costs ZERO cloud quota and is reproducible in CI. Every phase
//  re-runs this; docs/BENCHMARKS.md publishes the before/after deltas.
//
//  Usage:  npm run bench            → writes bench/baseline.json
//          npm run bench -- v1.4    → writes bench/v1.4.json
//          npm run bench -- --compare baseline v1.4   → prints a delta table
// ─────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { costUSD } from "../server/metrics.ts";
import type { ModelCall } from "../server/metrics.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BENCH_DIR = join(ROOT, "bench");
const PORT = Number(process.env.BENCH_PORT || 8799);
const BASE = `http://127.0.0.1:${PORT}`;

// ── THE SUITE — ~20 tasks spanning the request shapes SAM actually sees ──
type Category = "qa" | "generation" | "tool" | "multistep" | "file" | "repeat";
interface Task { id: string; category: Category; message: string; repeatOf?: string }

const SUITE: Task[] = [
  // simple Q&A / trivial (should be cheap — ideally local after Phase 1)
  { id: "greet-hi", category: "qa", message: "hi" },
  { id: "greet-thanks", category: "qa", message: "thanks!" },
  { id: "math", category: "qa", message: "what's 12 * 8?" },
  // pure generation (fast path — no tools)
  { id: "translate", category: "generation", message: "translate 'good morning' to French" },
  { id: "rewrite", category: "generation", message: "rewrite this to be punchier: our product is good" },
  { id: "names", category: "generation", message: "give me 3 name ideas for a coffee brand" },
  // standard knowledge Q&A
  { id: "explain", category: "qa", message: "explain what a semaphore is in simple terms" },
  { id: "proscons", category: "qa", message: "what are the pros and cons of remote work?" },
  { id: "strategy", category: "qa", message: "think through whether a startup should raise or bootstrap" },
  // single tool call (needs live/current info → agent loop)
  { id: "weather", category: "tool", message: "what's the weather in London today?" },
  { id: "search", category: "tool", message: "search the web for the best CRM 2026" },
  { id: "time-tokyo", category: "tool", message: "what time is it in Tokyo right now?" },
  // multi-step
  { id: "news-sum", category: "multistep", message: "find the latest news on AI regulation and summarize the top 3 points" },
  { id: "fx", category: "multistep", message: "look up the GBP to USD rate and tell me what £250 is in dollars" },
  // file questions
  { id: "docs-list", category: "file", message: "what's in my Documents folder?" },
  { id: "file-read", category: "file", message: "read my file notes.txt and summarize it" },
  // repeat questions (exercise the semantic cache — Phase 2)
  { id: "explain-again", category: "repeat", message: "explain what a semaphore is in simple terms", repeatOf: "explain" },
  { id: "greet-hi-again", category: "repeat", message: "hi", repeatOf: "greet-hi" },
  { id: "proscons-again", category: "repeat", message: "what are the pros and cons of remote work?", repeatOf: "proscons" },
  { id: "search-again", category: "repeat", message: "search the web for the best CRM 2026", repeatOf: "search" },
];

interface TaskResult {
  id: string; category: Category; message: string;
  tier: string; provider: string;
  promptTokens: number; outputTokens: number; totalTokens: number;
  costUSD: number; ttftMs: number | null; totalMs: number;
  cached: boolean; escalated: boolean; calls: number;
}

// ── SSE client: POST /api/stream, measure client-side TTFT + total ──
async function runTask(t: Task): Promise<{ ttftMs: number | null; totalMs: number }> {
  const started = Date.now();
  let ttftMs: number | null = null;
  const res = await fetch(`${BASE}/api/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: t.message }),
  });
  if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      try {
        const e = JSON.parse(line.slice(5).trim());
        if ((e.type === "token" || e.type === "done") && ttftMs === null) ttftMs = Date.now() - started;
      } catch { /* ignore keep-alive */ }
    }
  }
  return { ttftMs, totalMs: Date.now() - started };
}

async function drain(): Promise<ModelCall[]> {
  try {
    const r = await fetch(`${BASE}/api/bench/drain`);
    if (!r.ok) return [];
    return (await r.json())?.calls ?? [];
  } catch { return []; }
}

async function waitReady(timeoutMs = 30000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// ── Aggregate + report ───────────────────────────────────────
function aggregate(rows: TaskResult[]) {
  const n = rows.length;
  const sum = (f: (r: TaskResult) => number) => rows.reduce((a, r) => a + f(r), 0);
  const tierCount = (tier: string) => rows.filter((r) => r.tier === tier).length;
  const freeOrLocal = rows.filter((r) => r.tier === "local" || r.tier === "free").length;
  return {
    tasks: n,
    avgPromptTokens: +(sum((r) => r.promptTokens) / n).toFixed(1),
    avgOutputTokens: +(sum((r) => r.outputTokens) / n).toFixed(1),
    avgTotalTokens: +(sum((r) => r.totalTokens) / n).toFixed(1),
    totalCostUSD: +sum((r) => r.costUSD).toFixed(6),
    avgCostUSD: +(sum((r) => r.costUSD) / n).toFixed(6),
    avgTtftMs: +(sum((r) => r.ttftMs ?? r.totalMs) / n).toFixed(1),
    avgTotalMs: +(sum((r) => r.totalMs) / n).toFixed(1),
    tierMix: { local: tierCount("local"), free: tierCount("free"), premium: tierCount("premium") },
    pctFreeOrLocal: +((freeOrLocal / n) * 100).toFixed(1),
    cachedTasks: rows.filter((r) => r.cached).length,
    escalatedTasks: rows.filter((r) => r.escalated).length,
  };
}

function pad(s: string | number, w: number) { return String(s).padEnd(w); }
function padL(s: string | number, w: number) { return String(s).padStart(w); }

function printTable(rows: TaskResult[], agg: ReturnType<typeof aggregate>) {
  console.log("\n" + pad("task", 18) + pad("cat", 11) + padL("tier", 8) + padL("promptTk", 10) + padL("outTk", 7) + padL("cost$", 11) + padL("ttft", 7) + padL("total", 8) + "  cache");
  console.log("─".repeat(92));
  for (const r of rows) {
    console.log(
      pad(r.id, 18) + pad(r.category, 11) + padL(r.tier, 8) + padL(r.promptTokens, 10) +
      padL(r.outputTokens, 7) + padL(r.costUSD.toFixed(6), 11) + padL(r.ttftMs ?? "-", 7) +
      padL(r.totalMs + "ms", 8) + "  " + (r.cached ? "✓ HIT" : "")
    );
  }
  console.log("─".repeat(92));
  console.log(`\nSUMMARY (${agg.tasks} tasks)`);
  console.log(`  avg prompt tokens : ${agg.avgPromptTokens}`);
  console.log(`  avg output tokens : ${agg.avgOutputTokens}`);
  console.log(`  avg total tokens  : ${agg.avgTotalTokens}`);
  console.log(`  total cost (USD)  : $${agg.totalCostUSD}   (avg $${agg.avgCostUSD}/task)`);
  console.log(`  avg TTFT          : ${agg.avgTtftMs} ms`);
  console.log(`  avg total latency : ${agg.avgTotalMs} ms`);
  console.log(`  tier mix          : local ${agg.tierMix.local} · free ${agg.tierMix.free} · premium ${agg.tierMix.premium}`);
  console.log(`  % free-or-local   : ${agg.pctFreeOrLocal}%`);
  console.log(`  cache hits        : ${agg.cachedTasks}   escalations: ${agg.escalatedTasks}`);
}

// ── Compare mode: bench -- --compare <before> <after> ──
function compare(beforeName: string, afterName: string) {
  const a = JSON.parse(readFileSync(join(BENCH_DIR, `${beforeName}.json`), "utf8"));
  const b = JSON.parse(readFileSync(join(BENCH_DIR, `${afterName}.json`), "utf8"));
  const A = a.summary, B = b.summary;
  const pct = (before: number, after: number) => before === 0 ? (after === 0 ? "0%" : "+∞") : `${(((after - before) / before) * 100).toFixed(1)}%`;
  console.log(`\nCOMPARE  ${beforeName} → ${afterName}\n` + "─".repeat(60));
  const row = (label: string, x: number, y: number, unit = "") =>
    console.log(pad(label, 22) + padL(x + unit, 14) + padL(y + unit, 14) + padL(pct(x, y), 10));
  console.log(pad("metric", 22) + padL(beforeName, 14) + padL(afterName, 14) + padL("Δ", 10));
  row("avg cost/task ($)", A.avgCostUSD, B.avgCostUSD);
  row("avg total tokens", A.avgTotalTokens, B.avgTotalTokens);
  row("avg prompt tokens", A.avgPromptTokens, B.avgPromptTokens);
  row("avg TTFT (ms)", A.avgTtftMs, B.avgTtftMs);
  row("avg latency (ms)", A.avgTotalMs, B.avgTotalMs);
  row("% free-or-local", A.pctFreeOrLocal, B.pctFreeOrLocal, "%");
  row("cache hits", A.cachedTasks, B.cachedTasks);
  console.log("");
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--compare") { compare(args[1] || "baseline", args[2] || "v1.4"); return; }
  const name = args[0] || "baseline";

  if (!existsSync(BENCH_DIR)) mkdirSync(BENCH_DIR, { recursive: true });

  console.log(`\n⚡ SAM benchmark → ${name}.json  (mock brain · offline · zero quota)\n`);

  // Boot the real server with the deterministic mock brain, isolated port, no background jobs.
  const bootT0 = Date.now();
  const child: ChildProcess = spawn("npx", ["tsx", "server/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, SAM_BENCH_MOCK: "1", PORT: String(PORT), SAM_P2P: "0", SAM_REMOTE: "0" },
    stdio: ["ignore", "ignore", "inherit"],
  });

  const cleanup = () => { try { child.kill("SIGTERM"); } catch { /* already gone */ } };
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(1); });

  try {
    if (!await waitReady()) throw new Error(`server did not become ready on :${PORT}`);
    const bootMs = Date.now() - bootT0;   // spawn → /api/health ok (tsx cold-start included)
    // small settle so lazy boot indexing finishes
    await new Promise((r) => setTimeout(r, 500));
    await drain();   // clear any boot-time calls

    const rows: TaskResult[] = [];
    for (const t of SUITE) {
      const { ttftMs, totalMs } = await runTask(t);
      const calls = await drain();
      const promptTokens = calls.reduce((a, c) => a + c.promptTokens, 0);
      const outputTokens = calls.reduce((a, c) => a + c.outputTokens, 0);
      const cost = calls.reduce((a, c) => a + costUSD(c), 0);
      // The tier/provider that produced the user-facing answer = the last call.
      const last = calls[calls.length - 1];
      rows.push({
        id: t.id, category: t.category, message: t.message,
        tier: last?.tier ?? "none", provider: last?.provider ?? "none",
        promptTokens, outputTokens, totalTokens: promptTokens + outputTokens,
        costUSD: cost, ttftMs, totalMs,
        cached: calls.some((c) => c.cached), escalated: calls.some((c) => c.escalated),
        calls: calls.length,
      });
      console.log(`  ✓ ${pad(t.id, 18)} ${padL(last?.tier ?? "?", 8)} ${padL(totalMs + "ms", 8)}`);
    }

    const agg = aggregate(rows);
    printTable(rows, agg);

    console.log(`  server boot       : ${bootMs} ms  (spawn → ready, tsx cold-start)`);
    const out = { name, generatedAt: new Date().toISOString(), suiteSize: SUITE.length, summary: { ...agg, bootMs }, tasks: rows };
    writeFileSync(join(BENCH_DIR, `${name}.json`), JSON.stringify(out, null, 2));
    console.log(`\n📊 saved → bench/${name}.json\n`);
  } finally {
    cleanup();
  }
}

main().catch((e) => { console.error("bench failed:", e?.message || e); process.exit(1); });
