import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock the model so tests run fast and offline without network or keys
vi.mock("./models.ts", () => ({
  runModel: vi.fn(async (_tier, _sys, prompt) => {
    if (typeof prompt === "string" && prompt.includes("Goal: Health status check")) {
      return { text: "Synthesis: All 2 health checks passed.", provider: "test", tier: "local" };
    }
    if (typeof prompt === "string" && prompt.includes("50x Parallel Swarm Execution")) {
      return { text: "Synthesis: All parallel subtasks completed successfully.", provider: "test", tier: "local" };
    }
    return { text: "Task completed successfully with output.", provider: "test", tier: "local" };
  }),
  streamModel: vi.fn(async (_t, _s, _p, onChunk) => {
    onChunk?.("done");
    return { text: "done", provider: "test", tier: "local" };
  }),
  grammarReaches: vi.fn(async () => false),
}));

import { swarmFanout, type FanoutTask } from "./swarm.ts";
import { swarmFanoutTool, codebaseScanParallelTool, isCredentialPath } from "./tools.ts";
import { parseToolBatch } from "./agent.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sam-fanout-test-"));
  process.env.VAULT_DIR = dir;
});
afterEach(() => {
  delete process.env.VAULT_DIR;
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("50x Scaling Architecture", () => {
  describe("swarmFanout", () => {
    it("runs multiple subagent tasks in parallel with bounded concurrency", async () => {
      const tasks: FanoutTask[] = [
        { task: "Analyze module A", specialistId: "scout" },
        { task: "Refactor module B", specialistId: "coder" },
        { task: "Inspect tests in module C", specialistId: "investigator" },
      ];

      const res = await swarmFanout(tasks, {
        concurrency: 4,
        synthesize: false,
      });

      expect(res.total).toBe(3);
      expect(res.results.length).toBe(3);
      expect(res.results.map((r) => r.specialist)).toEqual(["scout", "coder", "investigator"]);
      expect(res.results.every((r) => typeof r.durationMs === "number")).toBe(true);
    });

    it("caps fan-out at 50 sub-tasks safely", async () => {
      const tasks: string[] = Array.from({ length: 60 }, (_, i) => `Subtask item ${i + 1}`);
      const res = await swarmFanout(tasks, { concurrency: 10, synthesize: false });
      expect(res.total).toBe(50);
      expect(res.results.length).toBe(50);
    });

    it("synthesizes results when requested", async () => {
      const tasks = ["Check status 1", "Check status 2"];
      const res = await swarmFanout(tasks, { synthesize: true, goal: "Health status check" });
      expect(res.total).toBe(2);
      expect(typeof res.synthesis).toBe("string");
      expect(res.synthesis).toContain("Synthesis:");
    });
  });

  describe("swarmFanoutTool", () => {
    it("formats fan-out execution output cleanly", async () => {
      const out = await swarmFanoutTool({
        tasks: [
          { task: "Task 1", specialist: "coder" },
          { task: "Task 2", specialist: "scout" },
        ],
        concurrency: 2,
        synthesize: true,
        goal: "Test run",
      });

      expect(out).toContain("Swarm Fan-Out (50x Concurrency)");
      expect(out).toContain("coder: \"Task 1\"");
      expect(out).toContain("scout: \"Task 2\"");
      expect(out).toContain("50x Swarm Synthesis");
    });

    it("rejects empty task lists", async () => {
      const out = await swarmFanoutTool({ tasks: [] });
      expect(out).toContain("Error: tasks array is required");
    });
  });

  describe("codebaseScanParallelTool", () => {
    it("scans files concurrently with regex matching and AST node detection", async () => {
      const file1 = join(dir, "service.ts");
      const file2 = join(dir, "controller.ts");
      const file3 = join(dir, "types.ts");

      writeFileSync(
        file1,
        `export class OrderService {\n  processOrder(id: string) {\n    return "processed " + id;\n  }\n}`
      );
      writeFileSync(
        file2,
        `export function handleRequest() {\n  const id = "ord-123";\n  return id;\n}`
      );
      writeFileSync(
        file3,
        `export interface OrderConfig {\n  id: string;\n  retryCount: number;\n}`
      );

      const out = await codebaseScanParallelTool({
        path: dir,
        pattern: "id",
        includeAst: true,
        concurrency: 4,
      });

      expect(out).toContain("Parallel Codebase Scan (50x Scanner)");
      expect(out).toContain("service.ts");
      expect(out).toContain("controller.ts");
      expect(out).toContain("types.ts");
    });

    it("reports clean message when no files match", async () => {
      writeFileSync(join(dir, "sample.ts"), "const x = 123;");
      const out = await codebaseScanParallelTool({
        path: dir,
        pattern: "nonexistent_term_xyz",
      });
      expect(out).toContain("No matches found");
    });

    // AUDIT FIX: shipped safe:true (auto-runs, no approval) with zero credential-path
    // awareness — the same bug class already found and fixed twice this session in
    // run_safe_command and grep_search. codebase_scan_parallel reads real file content and
    // returns matching lines; pointed at a credential directory it would leak them the same way.
    it("refuses outright when the scan root itself is a credential path", async () => {
      const out = await codebaseScanParallelTool({ path: "~/.ssh", pattern: "anything" });
      expect(out).toContain("Blocked");
      expect(out).toContain("credential");
    });

    it("the per-file isCredentialPath filter rejects a credential-directory path directly", () => {
      // walkFiles already refuses to descend into any dot-prefixed directory (including .ssh),
      // so an end-to-end scan can't actually reach this branch today — confirmed by temporarily
      // removing the filter and re-running: the walkFiles-level skip alone still passed the
      // "refuses outright" test above. This exercises the filter predicate itself directly, so
      // the check stays proven correct if the extension whitelist or walkFiles' skip logic ever
      // changes and this stops being unreachable.
      expect(isCredentialPath(join(dir, ".ssh", "notes.md"))).toBe(true);
      expect(isCredentialPath(join(dir, "normal.ts"))).toBe(false);
    });
  });

  describe("parseToolBatch 50x", () => {
    it("parses large batches up to 50 concurrent tool calls", () => {
      const tools = Array.from({ length: 45 }, (_, i) => ({
        tool: "read_file",
        input: { path: `file_${i}.ts` },
      }));
      const json = JSON.stringify({ tools });
      const parsed = parseToolBatch(json);
      expect(parsed).not.toBeNull();
      expect(parsed?.length).toBe(45);
      expect(parsed?.[0].tool).toBe("read_file");
    });
  });
});
