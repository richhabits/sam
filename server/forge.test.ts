import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import type { Tool } from "./tools.ts";

const SCRATCH = "/private/tmp/claude-501/-Users-romeovalentine/sam-forge-test";
let F: typeof import("./forge.ts");
let A: typeof import("./authz.ts");
let TOOLS: Tool[];

beforeAll(async () => {
  process.env.VAULT_DIR = SCRATCH;
  rmSync(SCRATCH, { recursive: true, force: true });
  F = await import("./forge.ts");
  A = await import("./authz.ts");
  ({ TOOLS } = await import("./tools.ts"));
});
afterEach(() => {
  for (const t of F.listForged()) F.deleteForged(t.name);
  F.syncForgedRegistry();
});

function writeForged(t: any) {
  const dir = `${SCRATCH}/forged`; mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${t.name}.json`, JSON.stringify({ enabled: false, createdAt: 1, caps: [], tests: [], ...t }));
}

describe("static safety scan", () => {
  it("rejects every ambient escape hatch", () => {
    for (const bad of [
      "(i)=>eval(i)", "(i)=>Function('return '+i)()", "(i)=>require('fs')",
      "(i)=>process.exit(1)", "(i)=>fetch('http://x')", "(i)=>{const{execSync}=require('child_process')}",
      "(i)=>{while(true){}}", "(i)=>globalThis.x", "(i)=>i.constructor.constructor('x')()",
    ]) expect(F.scanCode(bad).ok, bad).toBe(false);
  });
  it("passes pure computation", () => {
    expect(F.scanCode("(i)=>i.toUpperCase()").ok).toBe(true);
  });
  it("allows sam.* ONLY when the matching capability is declared", () => {
    expect(F.scanCode("(i,sam)=>sam.fetch(i)", []).ok).toBe(false);        // net not declared
    expect(F.scanCode("(i,sam)=>sam.fetch(i)", ["net"]).ok).toBe(true);
    expect(F.scanCode("(i,sam)=>sam.writeFile('a',i)", ["fs:read"]).ok).toBe(false);   // wrong cap
    expect(F.scanCode("(i,sam)=>sam.writeFile('a',i)", ["fs:write"]).ok).toBe(true);
  });
});

describe("capability → tier", () => {
  it("pure and fs:read are confirm; net and fs:write are dangerous", () => {
    expect(F.tierForCaps([])).toBe("confirm");
    expect(F.tierForCaps(["fs:read"])).toBe("confirm");
    expect(F.tierForCaps(["net"])).toBe("dangerous");
    expect(F.tierForCaps(["fs:write"])).toBe("dangerous");
  });
});

describe("sandbox (async)", () => {
  it("runs a pure function and returns a string", async () => {
    expect(await F.sandboxRun("(i)=>i.split('').reverse().join('')", "abc")).toBe("cba");
  });
  it("has no ambient require/process/fetch", async () => {
    expect(await F.sandboxRun("(i)=>typeof process", "")).toBe("undefined");
    expect(await F.sandboxRun("(i)=>typeof require", "")).toBe("undefined");
    expect(await F.sandboxRun("(i)=>typeof fetch", "")).toBe("undefined");
  });
  it("sam is empty unless a capability is injected", async () => {
    expect(await F.sandboxRun("(i,sam)=>typeof sam.fetch", "", [])).toBe("undefined");
    expect(await F.sandboxRun("(i,sam)=>typeof sam.fetch", "", ["net"])).toBe("function");
  });
  it("fs:write shim is confined to the tool sandbox (no traversal)", async () => {
    await F.sandboxRun("(i,sam)=>sam.writeFile('../../escape.txt','x')", "", ["fs:write"], "t1");
    const out = await F.sandboxRun("(i,sam)=>sam.readFile('escape.txt')", "", ["fs:read"], "t1");
    expect(out).toBe("x");   // basename-sanitised — landed inside the sandbox, never at ../../
  });
  it("blocks eval inside the sandbox", async () => {
    await expect(F.sandboxRun("(i)=>eval('1+1')", "")).rejects.toBeTruthy();
  });
});

describe("live registry + hard rules", () => {
  it("a net forged tool registers as DANGEROUS (marked in authz), never safe", () => {
    writeForged({ name: "fetcher", description: "fetches", params: "url", explanation: "gets a url", code: "(i,sam)=>sam.fetch(i)", caps: ["net"] });
    F.setForgedEnabled("fetcher", true);
    const reg = TOOLS.find((t) => t.name === "fetcher") as any;
    expect(reg?.safe).toBe(false);
    expect(reg?.forged).toBe(true);
    expect(A.isDangerous("fetcher")).toBe(true);              // net ⇒ dangerous, gated
    expect(A.toolTier("fetcher", false)).toBe("dangerous");
    F.setForgedEnabled("fetcher", false);
    expect(A.isDangerous("fetcher")).toBe(false);             // unmarked on unregister
  });
  it("a pure forged tool is confirm-tier (not dangerous)", () => {
    writeForged({ name: "shout", description: "upper", params: "i", explanation: "shouts", code: "(i)=>String(i).toUpperCase()", caps: [] });
    F.setForgedEnabled("shout", true);
    expect(A.isDangerous("shout")).toBe(false);
    expect(A.toolTier("shout", false)).toBe("confirm");
  });
  it("never registers code that fails the scan (defence in depth)", () => {
    writeForged({ name: "evil", description: "x", params: "i", explanation: "x", code: "(i)=>require('fs')", caps: [], enabled: true });
    expect(F.syncForgedRegistry()).toBe(0);
    expect(TOOLS.find((t) => t.name === "evil")).toBeUndefined();
  });
  it("a dangerous forged tool can never be standing-allowed", () => {
    writeForged({ name: "writer", description: "writes", params: "i", explanation: "writes a file", code: "(i,sam)=>sam.writeFile('a.txt',i)", caps: ["fs:write"], enabled: true });
    F.syncForgedRegistry();
    A.allow("writer");                                        // must be a no-op for dangerous
    expect(A.isAllowed("writer")).toBe(false);
  });
});
