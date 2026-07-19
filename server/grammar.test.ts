import { describe, expect, it } from "vitest";
import { argObjectSchema, replySchema, unwrapRespond, type JsonSchema } from "./grammar.ts";
import { TOOLS } from "./tools.ts";
import { validateArgs } from "./parser.ts";

// The Grammar derives a constrained-decoding schema from the tool registry — the SAME source of
// truth the Parser validates against. A constrained turn is a tool call OR a {"respond":"..."} final
// answer. These prove the derivation, the single-source-of-truth agreement, and the unwrap.

describe("argObjectSchema — one tool's input, derived from its ArgSchema", () => {
  it("maps types, required, and forbids invented arguments", () => {
    const s = argObjectSchema({ path: { type: "string", required: true }, count: { type: "number" }, mode: { type: "string", enum: ["fast", "safe"] } });
    expect(s).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: { path: { type: "string" }, count: { type: "number" }, mode: { type: "string", enum: ["fast", "safe"] } },
    });
  });
  it("an unschema'd tool becomes a permissive object (the Parser does name-only)", () => {
    expect(argObjectSchema(undefined)).toEqual({ type: "object" });
  });
});

describe("replySchema — derived entirely from the registry", () => {
  const schema = replySchema(TOOLS) as { oneOf: JsonSchema[] };
  it("is a oneOf covering every tool plus the {respond} final-answer form", () => {
    expect(Array.isArray(schema.oneOf)).toBe(true);
    expect(schema.oneOf.length).toBe(TOOLS.length + 1);
    const respond = schema.oneOf[schema.oneOf.length - 1] as any;
    expect(respond.properties.respond).toEqual({ type: "string" });
  });
  it("constrains `tool` to the exact tool name (a hallucinated name is unrepresentable)", () => {
    const writeCall = schema.oneOf.find((s: any) => s.properties?.tool?.enum?.[0] === "write_file") as any;
    expect(writeCall).toBeTruthy();
    expect(writeCall.required).toEqual(["tool", "input"]);
  });
});

describe("single source of truth — the Grammar and the Parser agree", () => {
  it("write_file's grammar input schema matches what the Parser accepts/rejects", () => {
    const writeFile = TOOLS.find((t) => t.name === "write_file")!;
    const gschema = argObjectSchema(writeFile.args) as any;
    // Grammar side: path + content are required strings, nothing else allowed.
    expect(gschema.required.sort()).toEqual(["content", "path"]);
    expect(gschema.additionalProperties).toBe(false);
    // Parser side: same acceptance for a good call, same rejection for a bad one — one source.
    expect(validateArgs(writeFile.args, { path: "~/a", content: "hi" }).ok).toBe(true);
    expect(validateArgs(writeFile.args, { path: "~/a" }).ok).toBe(false);          // missing content
    expect(validateArgs(writeFile.args, { path: "~/a", content: "hi", extra: 1 }).ok).toBe(false); // additionalProperties
  });
});

describe("unwrapRespond — the constrained final-answer form", () => {
  it("extracts the text from a {respond} envelope, tolerating whitespace", () => {
    expect(unwrapRespond('{"respond":"here is your answer"}')).toBe("here is your answer");
    expect(unwrapRespond('  {"respond":"padded"}\n')).toBe("padded");
  });
  it("returns null for a tool call or plain prose (caller keeps the raw text)", () => {
    expect(unwrapRespond('{"tool":"get_datetime","input":{}}')).toBeNull();
    expect(unwrapRespond("just prose, no json")).toBeNull();
    expect(unwrapRespond('{"respond":42}')).toBeNull();   // wrong type → not a valid final answer
  });
});
