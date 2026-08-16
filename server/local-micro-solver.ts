// ─────────────────────────────────────────────────────────────
//  S.A.M. · LOCAL ZERO-TOKEN MICRO SOLVER
//
//  Evaluates deterministic queries (arithmetic, conversions, timestamps,
//  file size formatting, string transforms) in <1ms without calling
//  any external LLM API. 100% free, 0 API tokens consumed.
// ─────────────────────────────────────────────────────────────

export interface MicroSolverResult {
  solvedLocally: boolean;
  type: "math" | "timestamp" | "unit_conversion" | "string_format" | "unsupported";
  answer: string;
  tokensUsed: 0;
  costUsd: 0;
  durationMs: number;
}

export function trySolveLocally(input: string): MicroSolverResult {
  const t0 = Date.now();
  const raw = String(input || "").trim();

  if (!raw) {
    return {
      solvedLocally: true,
      type: "string_format",
      answer: "",
      tokensUsed: 0,
      costUsd: 0,
      durationMs: Math.max(1, Date.now() - t0),
    };
  }

  const p = raw.toLowerCase();

  // 1. Timestamps and Dates
  if (p === "time" || p === "current time" || p === "date" || p === "what time is it" || p === "what day is it" || p === "today") {
    const now = new Date();
    return {
      solvedLocally: true,
      type: "timestamp",
      answer: `Current Time: ${now.toLocaleTimeString()} · Date: ${now.toLocaleDateString()} (${now.toISOString()})`,
      tokensUsed: 0,
      costUsd: 0,
      durationMs: Math.max(1, Date.now() - t0),
    };
  }

  // 2. Pure Arithmetic (Safe regex whitelist: numbers, +, -, *, /, %, (, ), ^, .)
  const mathPattern = /^(?:calculate|compute|solve|eval)?\s*([0-9\s\+\-\*\/\%\(\)\.\^]+)$/i;
  const mathMatch = raw.match(mathPattern);
  if (mathMatch && mathMatch[1]) {
    const expr = mathMatch[1].trim();
    if (/[\+\-\*\/\%\^]/.test(expr) && !/[a-zA-Z_$]/.test(expr)) {
      try {
        const sanitized = expr.replace(/\^/g, "**");
        const val = Function(`"use strict"; return (${sanitized});`)();
        if (typeof val === "number" && !isNaN(val) && isFinite(val)) {
          return {
            solvedLocally: true,
            type: "math",
            answer: `${expr} = ${val}`,
            tokensUsed: 0,
            costUsd: 0,
            durationMs: Math.max(1, Date.now() - t0),
          };
        }
      } catch {
        // Fall through
      }
    }
  }

  // 3. Unit Conversions (Bytes -> KB/MB/GB, ms -> sec/min)
  const byteMatch = p.match(/^(\d+(?:\.\d+)?)\s*(bytes|kb|mb|gb|tb)\s+(?:to|in)\s+(bytes|kb|mb|gb|tb)$/);
  if (byteMatch) {
    const val = parseFloat(byteMatch[1]);
    const from = byteMatch[2];
    const to = byteMatch[3];
    const multipliers: Record<string, number> = {
      bytes: 1,
      kb: 1024,
      mb: 1024 * 1024,
      gb: 1024 * 1024 * 1024,
      tb: 1024 * 1024 * 1024 * 1024,
    };
    const inBytes = val * (multipliers[from] || 1);
    const converted = inBytes / (multipliers[to] || 1);
    return {
      solvedLocally: true,
      type: "unit_conversion",
      answer: `${val} ${from.toUpperCase()} = ${converted.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${to.toUpperCase()}`,
      tokensUsed: 0,
      costUsd: 0,
      durationMs: Math.max(1, Date.now() - t0),
    };
  }

  return {
    solvedLocally: false,
    type: "unsupported",
    answer: "Query requires LLM reasoning engine or external tools.",
    tokensUsed: 0,
    costUsd: 0,
    durationMs: Math.max(1, Date.now() - t0),
  };
}
