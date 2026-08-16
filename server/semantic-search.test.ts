import { beforeEach, afterEach } from "vitest";
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sam-test-")); process.env.VAULT_DIR = dir; });
afterEach(() => { delete process.env.VAULT_DIR; rmSync(dir, { recursive: true, force: true }); });

import { semanticSearchTool } from "./tools.ts";

vi.mock("./ingest.ts", () => ({
  ingestFolder: vi.fn(async () => ({ new: 0, unchanged: 10 })),
  searchDocs: vi.fn(async (q, k, floor) => {
    if (q === "nothing") return [];
    return [
      { text: "const token = 'expoToken';", source: "push.ts", score: 0.95 },
      { text: "export function manageTask() {}", source: "tools.ts", score: 0.88 }
    ];
  })
}));

describe("semanticSearchTool", () => {
  it("requires a query", async () => {
    const res = await semanticSearchTool({ query: " " });
    expect(res).toBe("Error: query required.");
  });

  it("returns matches", async () => {
    const res = await semanticSearchTool({ query: "push tokens" });
    expect(res).toContain("Found 2 semantic match(es):");
    expect(res).toContain("push.ts");
    expect(res).toContain("0.950");
  });

  it("handles no matches", async () => {
    const res = await semanticSearchTool({ query: "nothing" });
    expect(res).toContain("No semantic matches found");
  });
});
