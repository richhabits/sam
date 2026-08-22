import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { workerEntry } from "./supervisor.ts";

// This exists because the first drive of the yard found the worker "missing" on a built
// SAM: the entrypoint was derived from this module's own location, which moves when the
// server is bundled. The yard stayed silently down. Locating it must be checked, not assumed.
describe("finding the worker", () => {
  it("finds a runnable entrypoint in this checkout", () => {
    const entry = workerEntry();
    expect(entry).not.toBeNull();
    expect(existsSync(entry!.args[0])).toBe(true);
    expect(entry!.args[0]).toMatch(/yard-worker\.mjs$|worker\.ts$/);
  });

  it("hands back a command that exists", () => {
    const entry = workerEntry()!;
    // either the node binary running this test, or a local tool that is really there
    expect(entry.cmd === process.execPath || existsSync(entry.cmd)).toBe(true);
  });

  // A checkout must run ITS OWN source. dist/ goes stale silently: a worker bundled before
  // the last edit still starts, still claims jobs and still reports success while running
  // code nobody wrote today. That happened — a build loop ran the previous bundle, so a
  // feature's writes never occurred and DEFAULT_TIER was ignored, both of which read as
  // fresh bugs in code that had never actually executed.
  it("prefers this checkout's source over any built bundle", () => {
    const entry = workerEntry()!;
    // This repo has both (dist/yard-worker.mjs is built by `npm run build:server`), so the
    // choice is a real one here, not a default.
    expect(entry.args[0]).toMatch(/worker\.ts$/);
    expect(entry.args[0]).not.toMatch(/yard-worker\.mjs$/);
  });
});

describe("recognising the entrypoint", () => {
  it("knows both shapes it is launched as", async () => {
    const { isWorkerEntrypoint } = await import("./worker.ts");
    expect(isWorkerEntrypoint("/Users/x/sam/server/yard/worker.ts")).toBe(true);
    expect(isWorkerEntrypoint("/Users/x/sam/dist/yard-worker.mjs")).toBe(true);   // the bundled name
    expect(isWorkerEntrypoint("/Users/x/sam/dist/server.mjs")).toBe(false);       // the SERVER must never self-start a worker
    expect(isWorkerEntrypoint(undefined)).toBe(false);
  });
});
