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
