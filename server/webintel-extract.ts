// ─────────────────────────────────────────────────────────────
//  S.A.M. · WEBINTEL EXTRACT — structured data from a page via a schema + SAM's own brain.
//
//  The llm-scraper (mishushakov, MIT) capability, rebuilt as ours — NOT vendored. No Playwright,
//  no Vercel AI SDK: built on webintel.fetchClean + an INJECTED llm fn, so it uses SAM's existing
//  model calling (runs local via Ollama, key-free) and is unit-testable with a mock.
//  Pipeline: page → clean text → schema prompt → llm → robust JSON parse → type-coerce/validate.
//
//  Verified (webintel-extract.verify.mjs, 9/9): prompt building, loose JSON parse (fenced /
//  prefixed / garbage), type coercion ("1999"→1999, "yes"→true, scalar→string[]), missing-field
//  flagging, and the FULL pipeline live (real Wikipedia fetch → prompt → mock llm → struct).
//  This is webintel increment 2: "read a page" → "extract structured facts from a page".
// ─────────────────────────────────────────────────────────────
import { fetchClean } from "./webintel.ts";

export type FieldType = "string" | "number" | "boolean" | "string[]";
export type FieldSpec = FieldType | { type: FieldType; description?: string };
export type ExtractSchema = Record<string, FieldSpec>;
/** Inject SAM's model call here — e.g. (sys, prompt) => runBrain(...). Keeps this provider-agnostic + testable. */
export type LlmFn = (system: string, prompt: string) => Promise<string>;

export interface ExtractResult {
  url: string; ok: boolean; title?: string;
  data: Record<string, unknown> | null; issues: string[]; raw?: string; error?: string;
}

export interface ExtractOpts { instruction?: string; system?: string; maxChars?: number; timeoutMs?: number }

const typeOf = (s: FieldSpec): FieldType => (typeof s === "string" ? s : s.type);

export function buildExtractPrompt(schema: ExtractSchema, pageText: string, instruction?: string): string {
  const fields = Object.entries(schema).map(([k, v]) => {
    const d = typeof v === "object" && v.description ? ` — ${v.description}` : "";
    return `  "${k}": ${typeOf(v)}${d}`;
  }).join("\n");
  return `${instruction ? instruction + "\n\n" : ""}Extract the following fields from the page content and return ONLY a JSON object with exactly these keys (no prose, no markdown fences):
{
${fields}
}
Use null for anything not present. Numbers as numbers, booleans as true/false.

PAGE CONTENT:
${pageText}`;
}

/** Pull a JSON object out of a messy LLM response (fenced, prefixed, or with trailing junk). */
export function parseJsonLoose(text: string): unknown {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(t.slice(start, end + 1)); } catch { /* give up */ } }
  return null;
}

const matches: Record<FieldType, (x: unknown) => boolean> = {
  string: (x) => typeof x === "string",
  number: (x) => typeof x === "number" && !Number.isNaN(x),
  boolean: (x) => typeof x === "boolean",
  "string[]": (x) => Array.isArray(x) && x.every((y) => typeof y === "string"),
};

function coerce(v: unknown, t: FieldType): unknown {
  if (v === null || v === undefined) return null;
  if (matches[t](v)) return v;
  if (t === "number") {
    // Strip currency/units, but an unparseable string must become NULL, not 0. Number("") is 0,
    // so the old `Number(stripped)` turned "not a number" / "unknown" / "n/a" into a confident
    // zero — a fabricated fact, which in an extractor is worse than an admitted gap. Caught by
    // this module's own test while its "9/9" verify script missed the case.
    const stripped = String(v).replace(/[^0-9.\-]/g, "");
    if (!/\d/.test(stripped)) return null;
    const n = Number(stripped);
    return Number.isNaN(n) ? null : n;
  }
  if (t === "boolean") { const s = String(v).toLowerCase(); return s === "true" || s === "yes" ? true : s === "false" || s === "no" ? false : null; }
  if (t === "string") return typeof v === "object" ? JSON.stringify(v) : String(v);
  if (t === "string[]") return Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : null;
  return null;
}

export function coerceToSchema(obj: unknown, schema: ExtractSchema): { value: Record<string, unknown>; issues: string[] } {
  const value: Record<string, unknown> = {}, issues: string[] = [];
  const src = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
  for (const [k, spec] of Object.entries(schema)) {
    const c = coerce(src[k], typeOf(spec));
    value[k] = c;
    if (c === null && src[k] != null) issues.push(`field '${k}': could not coerce ${JSON.stringify(src[k])} to ${typeOf(spec)}`);
    if (!(k in src)) issues.push(`field '${k}': missing from extraction`);
  }
  return { value, issues };
}

/** Extract structured data from a URL against a schema, using an injected LLM (SAM's brain). */
export async function extract(url: string, schema: ExtractSchema, llm: LlmFn, opts: ExtractOpts = {}): Promise<ExtractResult> {
  const page = await fetchClean(url, { timeoutMs: opts.timeoutMs });
  if (!page.ok || !page.text) return { url, ok: false, error: page.error || "no readable content", data: null, issues: [] };
  const system = opts.system || "You are a precise web data extractor. Return ONLY valid JSON matching the requested keys. No prose, no markdown.";
  const prompt = buildExtractPrompt(schema, page.text.slice(0, opts.maxChars ?? 12000), opts.instruction);
  const raw = await llm(system, prompt);
  const { value, issues } = coerceToSchema(parseJsonLoose(raw), schema);
  return { url, ok: true, title: page.title, data: value, issues, raw };
}
