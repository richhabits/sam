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


/** Evaluate a tiny arithmetic expression without `Function` / `eval` (CodeQL js/code-injection).
 *  Accepts digits, whitespace, + - * / % ( ) and ** (from ^). Returns null if anything else sneaks in. */
function safeEvalArith(expr: string): number | null {
  const s = expr.replace(/\s+/g, "");
  if (!s || !/^[0-9+\-*/%().]+$/.test(s)) return null;
  let i = 0;
  const peek = () => s[i] || "";
  const get = () => s[i++] || "";
  function parseExpr(): number {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = get();
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parsePower();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = get();
      const r = parsePower();
      if (op === "*") v = v * r;
      else if (op === "/") v = v / r;
      else v = v % r;
    }
    return v;
  }
  function parsePower(): number {
    let v = parseUnary();
    // right-assoc **
    if (s.slice(i, i + 2) === "**") {
      i += 2;
      const r = parsePower();
      v = v ** r;
    }
    return v;
  }
  function parseUnary(): number {
    if (peek() === "+") { get(); return parseUnary(); }
    if (peek() === "-") { get(); return -parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary(): number {
    if (peek() === "(") {
      get();
      const v = parseExpr();
      if (peek() !== ")") throw new Error("expected )");
      get();
      return v;
    }
    const start = i;
    while (/[0-9.]/.test(peek())) get();
    if (start === i) throw new Error("expected number");
    const n = Number(s.slice(start, i));
    if (!Number.isFinite(n)) throw new Error("bad number");
    return n;
  }
  try {
    const v = parseExpr();
    if (i !== s.length) return null;
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
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
  const mathPattern = /^(?:calculate|compute|solve|eval)?\s*([0-9\s+\-*/%().^]+)$/i;
  const mathMatch = raw.match(mathPattern);
  if (mathMatch?.[1]) {
    const expr = mathMatch[1].trim();
    if (/[+\-*/%^]/.test(expr) && !/[a-zA-Z_$]/.test(expr)) {
      try {
        const sanitized = expr.replace(/\^/g, "**");
        const val = safeEvalArith(sanitized);
        if (typeof val === "number" && !Number.isNaN(val) && Number.isFinite(val)) {
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

  // 4. Distance conversions (miles/km/m/ft/in/cm)
  const distMatch = p.match(/^(\d+(?:\.\d+)?)\s*(miles|mile|mi|km|kilometers|kilometer|m|meters|meter|ft|feet|in|inches|cm)\s+(?:to|in)\s+(miles|mile|mi|km|kilometers|kilometer|m|meters|meter|ft|feet|in|inches|cm)$/);
  if (distMatch) {
    const val = parseFloat(distMatch[1]);
    const from = distMatch[2];
    const to = distMatch[3];
    const toMeters: Record<string, number> = {
      m: 1, meter: 1, meters: 1,
      km: 1000, kilometer: 1000, kilometers: 1000,
      cm: 0.01,
      in: 0.0254, inches: 0.0254,
      ft: 0.3048, feet: 0.3048,
      mi: 1609.344, mile: 1609.344, miles: 1609.344,
    };
    const meters = val * (toMeters[from] || 1);
    const converted = meters / (toMeters[to] || 1);
    return {
      solvedLocally: true,
      type: "unit_conversion",
      answer: `${val} ${from} = ${converted.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${to}`,
      tokensUsed: 0,
      costUsd: 0,
      durationMs: Math.max(1, Date.now() - t0),
    };
  }

  // 5. Weight & Mass Conversions (kg/g/mg/lbs/pounds/oz/ounces/stone)
  const weightMatch = p.match(/^(\d+(?:\.\d+)?)\s*(kg|kilograms|kilogram|g|grams|gram|mg|lbs|pounds|pound|lb|oz|ounces|ounce|stone)\s+(?:to|in)\s+(kg|kilograms|kilogram|g|grams|gram|mg|lbs|pounds|pound|lb|oz|ounces|ounce|stone)$/);
  if (weightMatch) {
    const val = parseFloat(weightMatch[1]);
    const from = weightMatch[2];
    const to = weightMatch[3];
    const toGrams: Record<string, number> = {
      g: 1, gram: 1, grams: 1,
      mg: 0.001,
      kg: 1000, kilogram: 1000, kilograms: 1000,
      oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
      lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
      stone: 6350.29,
    };
    const grams = val * (toGrams[from] || 1);
    const converted = grams / (toGrams[to] || 1);
    return {
      solvedLocally: true,
      type: "unit_conversion",
      answer: `${val} ${from} = ${converted.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${to}`,
      tokensUsed: 0,
      costUsd: 0,
      durationMs: Math.max(1, Date.now() - t0),
    };
  }

  // 6. Temperature Conversions (Celsius, Fahrenheit, Kelvin)
  const tempMatch = p.match(/^(-?\d+(?:\.\d+)?)\s*(c|celsius|f|fahrenheit|k|kelvin)\s+(?:to|in)\s+(c|celsius|f|fahrenheit|k|kelvin)$/);
  if (tempMatch) {
    const val = parseFloat(tempMatch[1]);
    const from = tempMatch[2][0]; // 'c', 'f', or 'k'
    const to = tempMatch[3][0];
    let celsius = val;
    if (from === "f") celsius = (val - 32) * (5 / 9);
    else if (from === "k") celsius = val - 273.15;

    let target = celsius;
    if (to === "f") target = celsius * (9 / 5) + 32;
    else if (to === "k") target = celsius + 273.15;

    const unitNames: Record<string, string> = { c: "°C", f: "°F", k: "K" };
    return {
      solvedLocally: true,
      type: "unit_conversion",
      answer: `${val}${unitNames[from]} = ${target.toFixed(2)}${unitNames[to]}`,
      tokensUsed: 0,
      costUsd: 0,
      durationMs: Math.max(1, Date.now() - t0),
    };
  }

  // 7. Time & Duration Conversions (seconds, minutes, hours, days, weeks)
  const timeMatch = p.match(/^(\d+(?:\.\d+)?)\s*(s|sec|seconds|second|min|minutes|minute|h|hr|hours|hour|d|days|day|w|weeks|week)\s+(?:to|in)\s+(s|sec|seconds|second|min|minutes|minute|h|hr|hours|hour|d|days|day|w|weeks|week)$/);
  if (timeMatch) {
    const val = parseFloat(timeMatch[1]);
    const from = timeMatch[2];
    const to = timeMatch[3];
    const toSeconds: Record<string, number> = {
      s: 1, sec: 1, second: 1, seconds: 1,
      min: 60, minute: 60, minutes: 60,
      h: 3600, hr: 3600, hour: 3600, hours: 3600,
      d: 86400, day: 86400, days: 86400,
      w: 604800, week: 604800, weeks: 604800,
    };
    const secs = val * (toSeconds[from] || 1);
    const converted = secs / (toSeconds[to] || 1);
    return {
      solvedLocally: true,
      type: "unit_conversion",
      answer: `${val} ${from} = ${converted.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${to}`,
      tokensUsed: 0,
      costUsd: 0,
      durationMs: Math.max(1, Date.now() - t0),
    };
  }

  // 8. Radix/Base Conversions (hex, bin, dec)
  const hexToDec = p.match(/^(?:0x([0-9a-f]+)|([0-9a-f]+)\s*hex)\s+(?:to|in)\s+(?:dec|decimal)$/);
  if (hexToDec) {
    const hex = hexToDec[1] || hexToDec[2];
    const dec = parseInt(hex, 16);
    return {
      solvedLocally: true,
      type: "math",
      answer: `0x${hex} in decimal = ${dec}`,
      tokensUsed: 0,
      costUsd: 0,
      durationMs: Math.max(1, Date.now() - t0),
    };
  }

  const decToHex = p.match(/^(\d+)\s+(?:to|in)\s+hex$/);
  if (decToHex) {
    const dec = parseInt(decToHex[1], 10);
    return {
      solvedLocally: true,
      type: "math",
      answer: `${dec} in hex = 0x${dec.toString(16).toUpperCase()}`,
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
