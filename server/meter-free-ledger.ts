// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE LEDGER — making the meter-free claim provable
//
//  The competitive read said it plainly: every metered agent product's #1 complaint is
//  the meter, and SAM structurally can't have that one. This is the number that proves
//  it every day instead of just claiming it — built entirely from real usage, never a
//  guess: real elapsed minutes of agent work this month (server/yard/store.ts's own job
//  table, the same rigour as its token meter), times a reference rate for what that much
//  work would cost on a typical metered cloud agent.
//
//  The reference rate lives in ONE editable, gitignored file (vault/**/*.json is already
//  excluded — see .gitignore) so it can be kept current without ever committing a
//  competitor's name or pricing structure to the repo (house law: no external product
//  names anywhere committed, including here). Deliberately generic and conservative: this
//  reports what work would cost, not what any specific product charges.
// ─────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getSavingsSummary } from "./cost-optimizer.ts";

// A function, not a module-load-time const: VAULT_DIR is set by electron/preboot.ts before
// any server module loads in the real app, so this would work either way there — but a
// captured-at-import const is still the wrong pattern (every other vault-file module in
// this codebase, e.g. cost-optimizer.ts, reads process.env lazily too) and it silently
// breaks tests that set VAULT_DIR per-case, which is exactly how this module's own tests work.
const ratesFile = (): string => join(process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault"), "meter-free-rates.json");

export interface Rates { usdPerAgentMinute: number; note: string }

// A conservative, generic default — not any one product's number, deliberately rounded
// down from the lower end of what's publicly typical for metered agent-minute pricing as
// of the 2026-08 competitive read. Meant to be edited, not treated as gospel.
const DEFAULT_RATES: Rates = {
  usdPerAgentMinute: 0.12,
  note: "Edit this file freely — it's yours, never committed (vault/**/*.json is gitignored). "
    + "usdPerAgentMinute is a conservative, generic reference for what a minute of autonomous "
    + "agent work typically costs on a metered cloud product, deliberately rounded down rather "
    + "than up. No product is named on purpose — see docs/_template.html / the house rule against "
    + "committing competitor names. Recalibrate whenever the competitive picture moves.",
};

function loadRates(): Rates {
  const file = ratesFile();
  try {
    if (!existsSync(file)) {
      const dir = dirname(file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(file, `${JSON.stringify(DEFAULT_RATES, null, 2)}\n`);
      return DEFAULT_RATES;
    }
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const rate = Number(parsed?.usdPerAgentMinute);
    // A corrupted or hand-edited-wrong file should degrade to the honest default, never
    // to a wild number (0, negative, NaN, or a typo'd extra zero) presented as real.
    if (!Number.isFinite(rate) || rate <= 0 || rate > 5) return DEFAULT_RATES;
    return { usdPerAgentMinute: rate, note: typeof parsed?.note === "string" ? parsed.note : DEFAULT_RATES.note };
  } catch {
    return DEFAULT_RATES;
  }
}

export interface MeterFreeSummary {
  monthTaskMinutes: number;
  usdPerAgentMinute: number;
  wouldHaveCostElsewhereUsd: number;   // this month, from real task minutes × the reference rate
  actualSpendLifetimeUsd: number;      // real provider spend, from the existing cost meter — lifetime, labelled honestly as such (it isn't month-bucketed)
  rateNote: string;
}

// store is whatever exposes taskMinutesThisMonth — typed loosely here rather than
// importing JobStore's full type, so this module never needs to know about jobs.db
// internals beyond the one number it asks for.
export function meterFreeSummary(store: { taskMinutesThisMonth: (now?: number) => number }, now = Date.now()): MeterFreeSummary {
  const minutes = Math.max(0, store.taskMinutesThisMonth(now));
  const rates = loadRates();
  const { ledger } = getSavingsSummary();
  return {
    monthTaskMinutes: Number(minutes.toFixed(1)),
    usdPerAgentMinute: rates.usdPerAgentMinute,
    wouldHaveCostElsewhereUsd: Number((minutes * rates.usdPerAgentMinute).toFixed(2)),
    actualSpendLifetimeUsd: Number(ledger.dollarsSpentTotal.toFixed(2)),
    rateNote: rates.note,
  };
}
