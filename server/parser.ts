// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE PARSER  — validate a model's tool call against the tool's schema before it runs.
//
//  SAM already EXTRACTS and repairs a tool call's JSON (agent.ts). The Parser is the next stage:
//  the shape parsed, but is it a REAL call? It checks the arguments against the tool's own arg
//  schema — the single source of truth — and REJECTS anything that doesn't conform. A call that
//  "sort of parsed" but names an unknown argument, omits a required one, or has the wrong type is
//  refused LOUDLY, never executed on a guess (that is the malformed-.replace() class wearing a
//  parser hat). On rejection it emits a precise diagnostic — expected vs got, per argument — for the
//  brain to self-correct. Tools with no schema get name-only validation upstream; the Parser is a
//  no-op for them, so adoption is incremental.
// ─────────────────────────────────────────────────────────────
import { err, ok, type Outcome } from "./outcome.ts";

export type ArgType = "string" | "number" | "boolean" | "array" | "object";

export interface ArgSpec {
  type: ArgType;
  required?: boolean;
  enum?: (string | number)[];   // if set, the value must be one of these
  items?: ArgType;              // for type:"array" — the element type each item must match
  desc?: string;                // human/model hint (not validated)
}
/** A tool's argument schema: the SINGLE source of truth the Parser validates against (and, later,
 *  the Grammar derives from). Attached to a Tool as `args?`. */
export type ArgSchema = Record<string, ArgSpec>;

export interface Problem { arg: string; expected: string; got: string }
// The Parser was already Outcome-shaped; unify it onto the canonical type. Success carries the
// validated arguments; failure carries the list of problems the diagnostic is built from.
export type Validation = Outcome<unknown, Problem[]>;

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v; // "string" | "number" | "boolean" | "object" | "undefined" | ...
}
function typeMatches(t: ArgType, v: unknown): boolean {
  switch (t) {
    case "array": return Array.isArray(v);
    case "object": return typeof v === "object" && v !== null && !Array.isArray(v);
    case "string": return typeof v === "string";
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "boolean": return typeof v === "boolean";
  }
}

/**
 * Validate a call's input against an arg schema. NO coercion — a wrong type is a rejection, not a
 * quiet fix, so the brain learns the real shape. Returns the validated object or the list of problems.
 */
export function validateArgs(schema: ArgSchema | undefined, input: unknown): Validation {
  // No schema → pass the input through UNCHANGED. Unschema'd tools handle their own input shapes
  // (e.g. read_file accepts a bare string OR {path}); normalising here would destroy that input.
  if (!schema) return ok(input);
  // The input itself must be a plain object.
  if (input != null && (typeof input !== "object" || Array.isArray(input))) {
    return err([{ arg: "(input)", expected: "an object", got: typeName(input) }]);
  }
  const obj = (input ?? {}) as Record<string, unknown>;
  const problems: Problem[] = [];
  for (const [name, spec] of Object.entries(schema)) {
    const present = name in obj && obj[name] != null;
    if (!present) {
      if (spec.required) problems.push({ arg: name, expected: `required ${spec.type}`, got: "missing" });
      continue;
    }
    const v = obj[name];
    if (!typeMatches(spec.type, v)) problems.push({ arg: name, expected: spec.type, got: typeName(v) });
    else if (spec.enum && !spec.enum.includes(v as string | number)) problems.push({ arg: name, expected: `one of [${spec.enum.join(", ")}]`, got: JSON.stringify(v) });
    else if (spec.type === "array" && spec.items) {
      const bad = (v as unknown[]).findIndex((el) => !typeMatches(spec.items!, el));
      if (bad >= 0) problems.push({ arg: `${name}[${bad}]`, expected: spec.items, got: typeName((v as unknown[])[bad]) });
    }
  }
  // Unknown arguments the schema doesn't declare → hallucinated; reject rather than silently drop.
  for (const k of Object.keys(obj)) if (!(k in schema)) problems.push({ arg: k, expected: "not a valid argument for this tool", got: "unexpected" });
  return problems.length ? err(problems) : ok(obj);
}

/** The argument NAMES only — safe to record/echo (never the values, which may be secret). */
export function problemArgs(problems: Problem[]): string[] { return problems.map((p) => p.arg); }

/**
 * A precise, self-correction-oriented diagnostic fed back to the brain. Structured "expected vs got"
 * per argument — enough for the model to fix the call on the next turn. Values are NOT echoed here.
 */
export function diagnostic(toolName: string, problems: Problem[]): string {
  const lines = problems.map((p) => `  • ${p.arg}: expected ${p.expected}, got ${p.got}`).join("\n");
  return `[SAM's call to "${toolName}" was rejected — it did not match the tool's arguments:\n${lines}\nReply with ONLY the corrected JSON tool call.]`;
}
