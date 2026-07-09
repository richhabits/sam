import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { rmSync } from "node:fs";
import type { Tool } from "./tools.ts";

const SCRATCH = "/private/tmp/claude-501/-Users-romeovalentine/sam-forge-test";
let F: typeof import("./forge.ts");
let TOOLS: Tool[];

beforeAll(async () => {
  process.env.VAULT_DIR = SCRATCH;
  rmSync(SCRATCH, { recursive: true, force: true });
  F = await import("./forge.ts");
  ({ TOOLS } = await import("./tools.ts"));
});
afterEach(() => {
  for (const t of F.listForged()) F.deleteForged(t.name);
  F.syncForgedRegistry();
});

describe("static safety scan", () => {
  it("rejects every escape hatch", () => {
    for (const bad of [
      "(i)=>eval(i)", "(i)=>Function('return '+i)()", "(i)=>require('fs')",
      "(i)=>process.exit(1)", "(i)=>fetch('http://x')", "(i)=>{const{execSync}=require('child_process');return execSync(i)}",
      "(i)=>readFile(i)", "(i)=>{while(true){}}", "(i)=>globalThis.x",
    ]) expect(F.scanCode(bad).ok, bad).toBe(false);
  });
  it("passes pure computation", () => {
    expect(F.scanCode("(i)=>i.toUpperCase()").ok).toBe(true);
    expect(F.scanCode("(i)=>String(Number(i)*2)").ok).toBe(true);
  });
});

describe("sandbox", () => {
  it("runs a pure function and returns a string", () => {
    expect(F.sandboxRun("(i)=>i.split('').reverse().join('')", "abc")).toBe("cba");
    expect(F.sandboxRun("(i)=>String(i*i)", 7)).toBe("49");
  });
  it("has no access to require/process/fetch (they throw)", () => {
    expect(() => F.sandboxRun("(i)=>typeof process", "")).not.toThrow();     // typeof undefined is fine
    expect(F.sandboxRun("(i)=>typeof process", "")).toBe("undefined");
    expect(F.sandboxRun("(i)=>typeof require", "")).toBe("undefined");
    expect(F.sandboxRun("(i)=>typeof fetch", "")).toBe("undefined");
  });
  it("times out a runaway loop instead of hanging", () => {
    // A counted mega-loop slips past the scan but must be killed by the vm timeout.
    expect(() => F.sandboxRun("(i)=>{let x=0;for(let k=0;k<1e12;k++){x+=k}return x}", "")).toThrow();
  });
  it("cannot generate code inside the sandbox (eval disabled)", () => {
    expect(() => F.sandboxRun("(i)=>eval('1+1')", "")).toThrow();
  });
});

describe("testForged", () => {
  it("passes valid samples, fails a thrower", () => {
    expect(F.testForged("(i)=>i+'!'", [{ input: "hi" }]).ok).toBe(true);
    expect(F.testForged("(i)=>{throw new Error('boom')}", [{ input: "x" }]).ok).toBe(false);
  });
});

describe("live registry hot-reload + hard rules", () => {
  it("only ENABLED forged tools register, always as confirm (never safe)", () => {
    // Hand-write a forged file (bypassing the model draft) to test registration.
    const { writeFileSync, mkdirSync } = require("node:fs");
    const dir = `${SCRATCH}/forged`; mkdirSync(dir, { recursive: true });
    const tool = { name: "shout", description: "uppercases", params: "input", explanation: "shouts text", code: "(i)=>String(i).toUpperCase()", tests: [{ input: "hi" }], enabled: false, createdAt: Date.now(), tier: "confirm" };
    writeFileSync(`${dir}/shout.json`, JSON.stringify(tool));

    expect(F.syncForgedRegistry()).toBe(0);                 // disabled → not registered
    expect(TOOLS.find((t) => t.name === "shout")).toBeUndefined();

    F.setForgedEnabled("shout", true);
    const reg = TOOLS.find((t) => t.name === "shout") as any;
    expect(reg).toBeDefined();
    expect(reg.safe).toBe(false);                           // HARD RULE: forged ⇒ never safe
    expect(reg.forged).toBe(true);

    F.setForgedEnabled("shout", false);
    expect(TOOLS.find((t) => t.name === "shout")).toBeUndefined();   // hot-unregister
  });

  it("refuses to register code that fails the scan (defence in depth)", () => {
    const { writeFileSync, mkdirSync } = require("node:fs");
    const dir = `${SCRATCH}/forged`; mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/evil.json`, JSON.stringify({ name: "evil", description: "x", params: "i", explanation: "x", code: "(i)=>require('fs')", tests: [], enabled: true, createdAt: Date.now(), tier: "confirm" }));
    expect(F.syncForgedRegistry()).toBe(0);                 // enabled but unsafe → still not registered
    expect(TOOLS.find((t) => t.name === "evil")).toBeUndefined();
  });
});
