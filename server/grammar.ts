// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE GRAMMAR  — constrain a local brain's output to a valid tool call at generation time.
//
//  The Parser validates a call AFTER the fact; the Grammar stops a malformed one being produced at
//  all. For brains that support constrained decoding (Ollama's `format` / a JSON schema), SAM hands
//  down a schema so every sampled token must fit the tool-call shape — a hallucinated tool name or
//  non-JSON simply cannot be emitted. The schema is DERIVED from the tool registry and each tool's
//  ArgSchema — the SAME single source of truth the Parser validates against — never a hand-kept copy.
//
//  A model turn is EITHER a tool call OR a final answer, so the schema is a oneOf of both, and the
//  final answer is wrapped as {"respond": "..."} so it stays expressible under the constraint. Brains
//  that can't be constrained (most cloud providers) ignore this and are guarded by the Parser instead.
// ─────────────────────────────────────────────────────────────

import type { ArgSchema } from "./parser.ts";

interface Tool { name: string; args?: ArgSchema }
// A minimal JSON Schema (the subset Ollama / llama.cpp accept). `unknown`-friendly, not exhaustive.
export type JsonSchema = Record<string, unknown>;

/** One tool's input as a JSON Schema object. Derived from its ArgSchema so the Grammar and the Parser
 *  can never disagree. additionalProperties:false — the model can't invent arguments. */
export function argObjectSchema(args: ArgSchema | undefined): JsonSchema {
  if (!args) return { type: "object" };   // unschema'd tool → any object; the Parser does name-only
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [name, spec] of Object.entries(args)) {
    const p: JsonSchema = { type: spec.type };
    if (spec.enum) p.enum = spec.enum;
    if (spec.type === "array" && spec.items) p.items = { type: spec.items };   // constrain each element's type
    if (spec.desc) p.description = spec.desc;                                    // a hint the model sees under the constraint
    properties[name] = p;
    if (spec.required) required.push(name);
  }
  const schema: JsonSchema = { type: "object", properties, additionalProperties: false };
  if (required.length) schema.required = required;
  return schema;
}

/** The tool-call envelope for one tool: {"tool": "<name>", "input": <that tool's input schema>}. */
function callSchemaFor(tool: Tool): JsonSchema {
  return {
    type: "object",
    properties: { tool: { type: "string", enum: [tool.name] }, input: argObjectSchema(tool.args) },
    required: ["tool", "input"],
    additionalProperties: false,
  };
}

/**
 * The full reply schema a constrained turn must satisfy: any one tool call (each with its own input
 * shape) OR a plain-text final answer wrapped as {"respond": "..."}. Derived entirely from `tools`.
 */
export function replySchema(tools: Tool[]): JsonSchema {
  return {
    oneOf: [
      ...tools.map(callSchemaFor),
      { type: "object", properties: { respond: { type: "string" } }, required: ["respond"], additionalProperties: false },
    ],
  };
}

/** Unwrap a constrained final answer: {"respond":"..."} → its text. Returns null if `text` isn't that
 *  shape (so the caller keeps the raw text). Tolerant parse — the model may pad with whitespace. */
export function unwrapRespond(text: string): string | null {
  try {
    const o = JSON.parse(text.trim());
    return o && typeof o === "object" && typeof o.respond === "string" ? o.respond : null;
  } catch { return null; }
}
