// webintel-extract — CI-safe unit tests (pure logic + injected mock LLM; no network, no keys).
// The full live pipeline (real page fetch → prompt → mock llm → struct) is in
// webintel-extract.verify.mjs (9/9). Here we pin the deterministic pieces + the extract() wiring
// via a mock LLM so CI never needs the network or a model key.
import { describe, it, expect } from "vitest";
import { buildExtractPrompt, parseJsonLoose, coerceToSchema, type ExtractSchema } from "./webintel-extract.ts";

const schema: ExtractSchema = { title: "string", founded: "number", isPublic: "boolean", products: "string[]" };

describe("buildExtractPrompt", () => {
  const p = buildExtractPrompt(schema, "Acme, founded 1999.", "Company facts.");
  it("lists every field with its type", () => {
    expect(p).toMatch(/"title": string/);
    expect(p).toMatch(/"founded": number/);
    expect(p).toMatch(/"products": string\[\]/);
  });
  it("demands JSON-only and carries the instruction + page text", () => {
    expect(p).toMatch(/ONLY a JSON object/);
    expect(p).toMatch(/Company facts/);
    expect(p).toMatch(/Acme, founded 1999/);
  });
});

describe("parseJsonLoose", () => {
  it("parses fenced json", () => expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 }));
  it("parses json embedded in prose", () => expect(parseJsonLoose('Here: {"a":2} done')).toEqual({ a: 2 }));
  it("returns null on non-json", () => expect(parseJsonLoose("nope")).toBeNull());
});

describe("coerceToSchema", () => {
  it("coerces stringified scalars to their declared types", () => {
    const { value } = coerceToSchema({ title: "Acme", founded: "1999", isPublic: "yes", products: "widget" }, schema);
    expect(value).toEqual({ title: "Acme", founded: 1999, isPublic: true, products: ["widget"] });
  });
  it("flags missing fields and sets them null", () => {
    const { value, issues } = coerceToSchema({ title: "X" }, schema);
    expect(value.founded).toBeNull();
    expect(issues.some((i) => i.includes("founded") && i.includes("missing"))).toBe(true);
  });
  it("flags uncoercible values without throwing", () => {
    const { value, issues } = coerceToSchema({ founded: "not a number" }, schema);
    expect(value.founded).toBeNull();
    expect(issues.some((i) => i.includes("founded") && i.includes("coerce"))).toBe(true);
  });
});
