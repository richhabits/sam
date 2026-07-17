// ─────────────────────────────────────────────────────────────
//  S.A.M. · skills tests — SKILL.md tools: allowlist parsing + validation
// ─────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import { parseFrontMatter, type Skill, validateSkillTools } from "./skills.ts";

describe("parseFrontMatter — tools: allowlist", () => {
  it("parses an inline list", () => {
    const { meta } = parseFrontMatter("---\nname: X\ntools: [web_search, get_datetime]\n---\nbody");
    expect(meta.tools).toEqual(["web_search", "get_datetime"]);
  });

  it("parses a block list", () => {
    const { meta } = parseFrontMatter("---\nname: X\ntools:\n  - web_search\n  - get_datetime\n---\nbody");
    expect(meta.tools).toEqual(["web_search", "get_datetime"]);
  });

  it("strips quotes from list items", () => {
    const { meta } = parseFrontMatter('---\ntools: ["web_search", \'get_datetime\']\n---\n');
    expect(meta.tools).toEqual(["web_search", "get_datetime"]);
  });

  it("leaves the body intact and yields no tools when none declared", () => {
    const { meta, body } = parseFrontMatter("---\nname: X\ntriggers: a, b\n---\nHello world");
    expect(meta.tools).toBeUndefined();
    expect(body).toBe("Hello world");
  });
});

describe("validateSkillTools — catch typos at boot", () => {
  const valid = new Set(["web_search", "get_datetime"]);
  const skill = (tools?: string[]): Skill => ({ id: "s", name: "s", tier: "free", triggers: [], tools, body: "" });

  it("flags a declared tool that doesn't exist", () => {
    const w = validateSkillTools([skill(["web_search", "nope"])], valid);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/nope/);
  });

  it("passes when every declared tool exists, or none is declared", () => {
    expect(validateSkillTools([skill(["web_search"])], valid)).toHaveLength(0);
    expect(validateSkillTools([skill(undefined)], valid)).toHaveLength(0);
  });
});
