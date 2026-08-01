// ─────────────────────────────────────────────────────────────
//  S.A.M. · npm run routes  — is the free lane actually alive?
//
//  This is the 2026-08-01 audit, made repeatable. That one was done by hand and found 7 of 11
//  free brains dead — three of them leading their lane, one taking 24 seconds to refuse — with
//  nothing in SAM reporting it, because the cascade falls through silently and a dead brain looks
//  exactly like a slow one.
//
//    npm run routes            what SAM has LEARNED from real use (costs nothing, calls nothing)
//    npm run routes -- --probe one tiny call to every free brain that has a key, then the table
//
//  --probe spends a few tokens of free quota on purpose: roughly 15 output tokens per brain. That
//  is the price of knowing, and it is the only way to measure a brain SAM hasn't happened to use.
// ─────────────────────────────────────────────────────────────

import { availableBrains, runBrain } from "../server/models.ts";
import { flushNow, record, report } from "../server/speed.ts";

const PROBE = process.argv.slice(2).includes("--probe");
const pad = (s: string, n: number) => s.padEnd(n);

if (PROBE) {
  const brains = availableBrains().filter((b) => b.tier === "free");
  console.log(`probing ${brains.length} free brains — one short call each\n`);
  for (const b of brains) {
    const t0 = Date.now();
    let text: string | null = null;
    try {
      text = await runBrain(b.id, "Answer in one short sentence.", "Say hello.");
    } catch { /* the health memory already recorded why, via the Relay */ }
    const ms = Date.now() - t0;
    // runBrain routes through the Relay, which records the outcome — this only covers the case
    // where a brain answers with empty text and no error at all.
    if (!text) record(b.id, { ms, ok: false });
    console.log(`  ${pad(b.id, 20)} ${text ? `${String(ms).padStart(6)}ms  ${text.replace(/\s+/g, " ").slice(0, 48)}` : `${String(ms).padStart(6)}ms  —`}`);
  }
  flushNow();
  console.log("");
}

const rows = report();
if (!rows.length) {
  console.log("Nothing measured yet. Use SAM for a bit, or run:  npm run routes -- --probe");
  process.exit(0);
}

console.log(`${pad("brain", 20)} ${pad("speed", 9)} ${pad("calls", 7)} ${pad("ok", 6)} state`);
console.log("─".repeat(64));
for (const r of rows) {
  console.log(`${pad(r.id, 20)} ${pad(r.ms ? `${r.ms}ms` : "—", 9)} ${pad(String(r.calls), 7)} ${pad(`${r.okRate}%`, 6)} ${r.state}`);
}
const dead = rows.filter((r) => r.state.startsWith("sunk"));
if (dead.length) {
  console.log(`\n${dead.length} sunk — still tried, never first. A retired model slug or an expired key looks like this;`);
  console.log("check the provider's own /v1/models list, then set e.g. CEREBRAS_MODEL=<live-slug> in .env.");
}
process.exit(0);
