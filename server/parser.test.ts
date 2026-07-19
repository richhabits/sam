import { describe, expect, it } from "vitest";
import { type ArgSchema, diagnostic, problemArgs, validateArgs } from "./parser.ts";
import { TOOLS } from "./tools.ts";

// The Parser validates a parsed tool call against the tool's arg schema and REJECTS anything that
// doesn't conform — wrong type, missing required, unknown arg, bad enum — with a precise diagnostic.
// No coercion: a mismatch is a rejection so the brain learns the real shape. Tools with no schema
// are a no-op (name-only validation upstream). The write_file schema is the Preview → Commit gate.

const schema: ArgSchema = {
  path: { type: "string", required: true },
  count: { type: "number" },
  mode: { type: "string", enum: ["fast", "safe"] },
};

describe("validateArgs — accepts a conforming call", () => {
  it("passes required + optional + enum when all correct", () => {
    const v = validateArgs(schema, { path: "~/a.txt", count: 3, mode: "safe" });
    expect(v.ok).toBe(true);
    if (v.ok) expect((v.value as { path: string }).path).toBe("~/a.txt");
  });
  it("passes with only the required field present", () => {
    expect(validateArgs(schema, { path: "~/a.txt" }).ok).toBe(true);
  });
  it("no schema → always ok (incremental adoption); input passes through UNCHANGED", () => {
    expect(validateArgs(undefined, { anything: 1 }).ok).toBe(true);
    // A bare-string input must survive untouched — read_file etc. accept `i.path ?? i`.
    const v = validateArgs(undefined, "bare string path");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value).toBe("bare string path");
  });
});

describe("validateArgs — rejects (never executes on a guess)", () => {
  it("missing required arg", () => {
    const v = validateArgs(schema, { count: 3 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContainEqual({ arg: "path", expected: "required string", got: "missing" });
  });
  it("wrong type — no silent coercion", () => {
    const v = validateArgs(schema, { path: 123 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContainEqual({ arg: "path", expected: "string", got: "number" });
  });
  it("value outside the enum", () => {
    const v = validateArgs(schema, { path: "x", mode: "reckless" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error[0]).toMatchObject({ arg: "mode", expected: "one of [fast, safe]" });
  });
  it("unknown/hallucinated argument", () => {
    const v = validateArgs(schema, { path: "x", nonsense: true });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(problemArgs(v.error)).toContain("nonsense");
  });
  it("input that isn't an object at all", () => {
    const v = validateArgs(schema, ["not", "an", "object"]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error[0]).toMatchObject({ arg: "(input)", expected: "an object", got: "array" });
  });
});

describe("diagnostic — precise, self-correction-oriented, value-free", () => {
  it("names each bad arg with expected vs got and asks for a corrected call", () => {
    const v = validateArgs(schema, { count: "three" });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const d = diagnostic("write_file", v.error);
      expect(d).toContain("write_file");
      expect(d).toContain("path: expected required string, got missing");
      expect(d).toContain("count: expected number, got string");
      expect(d).toMatch(/corrected JSON tool call/);
    }
  });
  it("problemArgs exposes names only — never a value (nothing to leak)", () => {
    const v = validateArgs(schema, { path: "SECRET-VALUE", nonsense: "SECRET-VALUE" });
    if (!v.ok) expect(problemArgs(v.error)).toEqual(["nonsense"]);
  });
});

describe("the Preview → Commit gate — write_file's real schema rejects a bad call", () => {
  const writeFile = TOOLS.find((t) => t.name === "write_file")!;
  it("write_file carries a machine schema requiring string path + content", () => {
    expect(writeFile.args).toMatchObject({ path: { type: "string", required: true }, content: { type: "string", required: true } });
  });
  it("a call missing content is rejected — it never reaches commit()", () => {
    const v = validateArgs(writeFile.args, { path: "~/notes.md" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(problemArgs(v.error)).toContain("content");
  });
  it("a well-formed write_file call validates", () => {
    expect(validateArgs(writeFile.args, { path: "~/notes.md", content: "hello" }).ok).toBe(true);
  });
});

describe("validateArgs — array item typing", () => {
  const s: ArgSchema = { urls: { type: "array", items: "string", required: true } };
  it("accepts an array whose elements all match the item type", () => {
    expect(validateArgs(s, { urls: ["a", "b", "c"] }).ok).toBe(true);
  });
  it("rejects a wrong-typed element, pointing at the index", () => {
    const v = validateArgs(s, { urls: ["a", 42, "c"] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContainEqual({ arg: "urls[1]", expected: "string", got: "number" });
  });
});

describe("the web_research schema (real registry) — per-tool input", () => {
  const wr = TOOLS.find((t) => t.name === "web_research")!;
  it("accepts {urls:[string], schema} and rejects a non-string url or a missing urls", () => {
    expect(validateArgs(wr.args, { urls: ["https://a", "https://b"], schema: { title: "string" } }).ok).toBe(true);
    expect(validateArgs(wr.args, { urls: [123] }).ok).toBe(false);
    expect(validateArgs(wr.args, { schema: {} }).ok).toBe(false);   // urls required
  });
});

describe("more object-input tools now carry accurate schemas (real registry)", () => {
  const argsOf = (n: string) => TOOLS.find((t) => t.name === n)!.args;
  it("translate requires text; currency/unit require amount:number + from + to", () => {
    expect(validateArgs(argsOf("translate"), { text: "hi", target_lang_code: "es" }).ok).toBe(true);
    expect(validateArgs(argsOf("translate"), { target_lang_code: "es" }).ok).toBe(false);      // missing text
    expect(validateArgs(argsOf("currency_convert"), { amount: 100, from: "USD", to: "EUR" }).ok).toBe(true);
    expect(validateArgs(argsOf("currency_convert"), { amount: "100", from: "USD", to: "EUR" }).ok).toBe(false); // number, not string
    expect(validateArgs(argsOf("unit_convert"), { amount: 5, from: "kg", to: "lb" }).ok).toBe(true);
  });
  it("toggle_dnd needs a boolean; add_calendar_event needs title+start+end; extras are rejected", () => {
    expect(validateArgs(argsOf("toggle_dnd"), { on: true }).ok).toBe(true);
    expect(validateArgs(argsOf("toggle_dnd"), { on: "yes" }).ok).toBe(false);
    expect(validateArgs(argsOf("add_calendar_event"), { title: "x", start_date: "a", end_date: "b" }).ok).toBe(true);
    expect(validateArgs(argsOf("add_calendar_event"), { title: "x", start_date: "a" }).ok).toBe(false);
    expect(validateArgs(argsOf("create_note"), { title: "n", body: "b", nonsense: 1 }).ok).toBe(false); // additionalProperties:false
  });
});
