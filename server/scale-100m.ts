// ─────────────────────────────────────────────────────────────
//  S.A.M. · SCALE STATUS (GROUND TRUTH ONLY)
//
//  Reports ONLY provably real metrics from live data sources.
//  Aspirational targets are clearly labelled as such with zero
//  progress until real revenue, customers, or trades exist.
//
//  Rule: if a number can't be read from a file, a database,
//  or a live API response, it MUST NOT appear here.
// ─────────────────────────────────────────────────────────────

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getSavingsSummary } from "./cost-optimizer.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface ScaleStatus {
  timestamp: number;

  /** Provably real metrics read from live data sources */
  actual: {
    revenueTotalGBP: number;
    payingCustomers: number;
    liveTradesExecuted: number;
    tradingPnlGBP: number;
    costSavings: {
      dollarsSaved: number;
      totalRequests: number;
      freeTierRequests: number;
      paidRequests: number;
    };
  };

  /** What exists as shipped, testable code (not revenue-generating) */
  codebaseInventory: {
    serverModules: number;
    testFiles: number;
    skillsLinked: number;
    knowledgeGraphNodes: number;
  };

  /** Clearly labelled aspirations — zero progress until real data backs them */
  targets: {
    label: string;
    targetGBP: number;
    actualGBP: number;
    note: string;
  }[];
}

/** Count .ts files in a directory matching a pattern. Best-effort, returns 0 on error. */
function countFiles(dir: string, filter: (name: string) => boolean): number {
  try {
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter(filter).length;
  } catch { return 0; }
}

/** Read a JSON file and return parsed content, or null on any error. */
function readJsonSafe(path: string): any {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch { return null; }
}

function countCodebaseInventory() {
  const serverDir = join(ROOT, "server");
  const yardDir = join(ROOT, "server", "yard");
  const skillsDir = join(ROOT, "server", "skills");
  const graphFile = join(ROOT, "graphify-out", "graph.json");

  const isSourceTs = (f: string) => f.endsWith(".ts") && !f.endsWith(".test.ts");
  const isTestTs = (f: string) => f.endsWith(".test.ts");

  const serverModules = countFiles(serverDir, isSourceTs) + countFiles(yardDir, isSourceTs);
  const testFiles = countFiles(serverDir, isTestTs) + countFiles(yardDir, isTestTs);

  // Skills: count subdirectories in server/skills/ (each skill is a directory)
  let skillsLinked = 0;
  try {
    if (existsSync(skillsDir)) {
      skillsLinked = readdirSync(skillsDir, { withFileTypes: true })
        .filter(d => d.isDirectory()).length;
    }
  } catch { /* best-effort */ }

  // Knowledge graph nodes: read from graphify-out/graph.json if it exists
  let knowledgeGraphNodes = 0;
  const graph = readJsonSafe(graphFile);
  if (graph && Array.isArray(graph.nodes)) {
    knowledgeGraphNodes = graph.nodes.length;
  }

  return { serverModules, testFiles, skillsLinked, knowledgeGraphNodes };
}

export function getScaleStatus(): ScaleStatus {
  // ── Pull REAL cost savings from the persistent ledger ──
  const savings = getSavingsSummary();
  const ledger = savings.ledger;
  const inventory = countCodebaseInventory();

  return {
    timestamp: Date.now(),

    actual: {
      revenueTotalGBP: 0,       // No revenue. Zero customers.
      payingCustomers: 0,        // No customers.
      liveTradesExecuted: 0,     // FlipIt has executed zero live trades.
      tradingPnlGBP: 0,         // No trading P&L.
      costSavings: {
        dollarsSaved: ledger?.dollarsSavedTotal ?? 0,
        totalRequests: ledger?.totalRequests ?? 0,
        freeTierRequests: ledger?.freeTierRequests ?? 0,
        paidRequests: ledger?.paidRequests ?? 0,
      },
    },

    codebaseInventory: inventory,

    targets: [
      {
        label: "£1M ARR",
        targetGBP: 1_000_000,
        actualGBP: 0,
        note: "Aspiration. No pricing validated. No customers acquired. No product shipped to market.",
      },
      {
        label: "£10M ARR",
        targetGBP: 10_000_000,
        actualGBP: 0,
        note: "Aspiration. Requires enterprise distribution, signed contracts, and proven retention. None exist.",
      },
      {
        label: "£100M Valuation",
        targetGBP: 100_000_000,
        actualGBP: 0,
        note: "Aspiration. Requires ~£8-10M ARR at 10-12x multiple, institutional investment, and market traction. Currently pre-revenue.",
      },
    ],
  };
}

