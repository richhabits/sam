import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCRATCH = "/tmp/sam-packs-test";
let P: typeof import("./packs.ts");
beforeAll(async () => {
  process.env.VAULT_DIR = join(SCRATCH, "vault");
  process.env.SAM_SKILLS_DIR = join(SCRATCH, "skills");
  P = await import("./packs.ts");
});
beforeEach(() => rmSync(SCRATCH, { recursive: true, force: true }));

const CONTENTS = {
  skills: [{ id: "landlord_helper", body: "# Landlord Helper\nAssist with disputes." }],
  tools: [
    { name: "slugify", description: "url slug", params: "input", explanation: "makes a url slug", code: "(i)=>String(i).toLowerCase().replace(/\\s+/g,'-')", caps: [] as any[] },
    { name: "sneaky", description: "evil", params: "i", explanation: "reads files", code: "(i)=>require('fs').readFileSync(i)", caps: [] as any[] },
  ],
  prompts: [{ title: "Cold email", text: "Write a cold email about {topic}" }],
  watchedTemplates: [{ label: "Documents", hint: "~/Documents" }],
};

describe("pack sign + verify", () => {
  it("exports a signed pack that verifies", () => {
    const json = P.exportPack({ name: "Landlord Pack", author: "user" }, CONTENTS as any, 1);
    const v = P.verifyPack(json);
    expect(v.ok).toBe(true);
    expect(v.signed).toBe(true);
    expect(v.sigValid).toBe(true);
  });
  it("rejects a tampered pack (present-but-invalid signature)", () => {
    const json = P.exportPack({ name: "P", author: "a" }, CONTENTS as any, 1);
    const obj = JSON.parse(json); obj.meta.name = "Hacked Pack";   // tamper after signing
    const v = P.verifyPack(JSON.stringify(obj));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/signature invalid/);
  });
  it("accepts an unsigned but well-formed pack (safety pipeline still gates it)", () => {
    const v = P.verifyPack(JSON.stringify({ format: "sampack/1", meta: { name: "x" }, contents: { skills: [], tools: [], prompts: [], watchedTemplates: [] } }));
    expect(v.ok).toBe(true);
    expect(v.signed).toBe(false);
  });
});

describe("import runs the forge pipeline and installs NOTHING", () => {
  it("flags the unsafe tool, marks the safe one, installs nothing on plan", async () => {
    const json = P.exportPack({ name: "P", author: "a" }, CONTENTS as any, 1);
    const plan = await P.planImport(json);
    expect(plan.ok).toBe(true);
    const slug = plan.tools!.find((t) => t.name === "slugify");
    const sneaky = plan.tools!.find((t) => t.name === "sneaky");
    expect(slug!.safe).toBe(true);
    expect(sneaky!.safe).toBe(false);
    expect(sneaky!.violations.length).toBeGreaterThan(0);
    // nothing installed by planning
    expect(existsSync(join(SCRATCH, "vault", "forged", "slugify.json"))).toBe(false);
  });
});

describe("apply installs only approved items, tools DISABLED, never unsafe code", () => {
  it("installs the chosen skill + safe tool (disabled); refuses the unsafe tool even if chosen", async () => {
    const json = P.exportPack({ name: "P", author: "a" }, CONTENTS as any, 1);
    const r = await P.applyPack(json, { skills: ["landlord_helper"], tools: ["slugify", "sneaky"] }, 2);
    expect(r.installedSkills).toContain("landlord_helper");
    expect(r.installedTools).toContain("slugify");
    expect(r.installedTools).not.toContain("sneaky");     // failed scan → never installed
    const forged = JSON.parse(readFileSync(join(SCRATCH, "vault", "forged", "slugify.json"), "utf8"));
    expect(forged.enabled).toBe(false);                    // installed DISABLED — review then enable
  });
  it("skips items the user did NOT approve", async () => {
    const json = P.exportPack({ name: "P", author: "a" }, CONTENTS as any, 1);
    const r = await P.applyPack(json, { skills: [], tools: [] }, 2);
    expect(r.installedSkills).toHaveLength(0);
    expect(r.installedTools).toHaveLength(0);
  });
});
