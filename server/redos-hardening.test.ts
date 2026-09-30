// CodeQL js/polynomial-redos hardening. Each block pins (a) the behaviour the regex had on
// ordinary input and (b) that a long adversarial string is handled in well under 100 ms. The
// budget is generous for a 50k-character input: a quadratic pattern needs seconds at this size.
import { describe, expect, it, vi } from "vitest";

vi.mock("./models.ts", () => ({
  runModel: vi.fn(async () => ({
    text: 'Sure! {"goal":"g","nodes":[{"id":"task-1","title":"T","task":"do","dependencies":[]}]} done',
  })),
}));

import { planTaskGraph } from "./agentic-100x.ts";
import { runCognitiveReflectionLoop, verifyFactualGrounding } from "./antigravity-brain.ts";
import { parseCompilerDiagnostics } from "./code-repair.ts";
import { stageGate } from "./curtain.ts";
import { trySolveLocally } from "./local-micro-solver.ts";
import { carriesKnownCredential, scrub } from "./scrub.ts";

const N = 50_000;
const BUDGET_MS = 100;

function timed<T>(fn: () => T): { out: T; ms: number } {
  const t0 = performance.now();
  const out = fn();
  return { out, ms: performance.now() - t0 };
}

describe("local-micro-solver math pattern (alert 159)", () => {
  it("still solves plain and verb-prefixed arithmetic", () => {
    expect(trySolveLocally("2 + 2").answer).toBe("2 + 2 = 4");
    expect(trySolveLocally("calculate 3*4").answer).toBe("3*4 = 12");
    expect(trySolveLocally("Solve (1+2)*3").answer).toBe("(1+2)*3 = 9");
    expect(trySolveLocally("2^10").answer).toBe("2^10 = 1024");
  });

  it("does not backtrack on a long run of whitespace", () => {
    for (const evil of [`calculate${"\t".repeat(N)}x`, `1${"\t".repeat(N)}x`, `eval${" ".repeat(N)}!`]) {
      const { ms } = timed(() => trySolveLocally(evil));
      expect(ms).toBeLessThan(BUDGET_MS);
    }
  });
});

describe("antigravity-brain percentage and import patterns (alerts 150, 151, 152)", () => {
  it("still flags a wrong percentage claim", () => {
    const r = verifyFactualGrounding("We fixed 10 out of 20 (90%) of them.");
    expect(r.discrepancies.some((d) => d.category === "MATH_INCONSISTENCY")).toBe(true);
    const ok = verifyFactualGrounding("We fixed 10 / 20 (approx 50%) of them.");
    expect(ok.discrepancies.some((d) => d.category === "MATH_INCONSISTENCY")).toBe(false);
  });

  it("still repairs a wrong percentage in the reflection loop", () => {
    const r = runCognitiveReflectionLoop("Done: 1 out of 4 (90%).", { autoFixMath: true });
    expect(r.reflectedText).toContain("25%");
  });

  it("still parses a relative import", () => {
    const r = verifyFactualGrounding('import { nothingHere } from "./definitely-missing-file"');
    expect(r).toBeDefined();
  });

  it("is fast on long digit runs and repeated import openers", () => {
    const inputs = [
      "0".repeat(N),
      `${"0".repeat(N)} out of`,
      `import {${"\t".repeat(N)}`,
      `import {\t${"\t".repeat(N)}x`,
      "import {".repeat(N / 8),
    ];
    for (const evil of inputs) {
      const { ms } = timed(() => verifyFactualGrounding(evil));
      expect(ms).toBeLessThan(BUDGET_MS);
    }
    const { ms } = timed(() => runCognitiveReflectionLoop("0".repeat(N), { autoFixMath: true }));
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe("code-repair diagnostic patterns (alerts 144, 145)", () => {
  it("still parses both compiler output shapes", () => {
    const out = parseCompilerDiagnostics(
      [
        "src/App.tsx(45,12): error TS2304: Cannot find name 'foo'.",
        "server/index.ts:12:5 - error TS2305: Module has no exported member 'y'.",
      ].join("\n"),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ filePath: "src/App.tsx", line: 45, column: 12, code: "TS2304", message: "Cannot find name 'foo'." });
    expect(out[1]).toMatchObject({ filePath: "server/index.ts", line: 12, column: 5, code: "TS2305" });
    expect(out[1].message).toBe("Module has no exported member 'y'.");
  });

  it("is fast on a long run of spaces after a near-match", () => {
    for (const evil of [`-(0,0):error:${" ".repeat(N)}\r`, `-:0:0-error:${" ".repeat(N)}\r`, `-:0:0${" ".repeat(N)}`]) {
      const { ms } = timed(() => parseCompilerDiagnostics(evil));
      expect(ms).toBeLessThan(BUDGET_MS);
    }
  });
});

describe("agentic-100x JSON extraction (alert 143)", () => {
  it("still extracts the JSON object from chatty model output", async () => {
    const g = await planTaskGraph("anything");
    expect(g.nodes[0].id).toBe("task-1");
    expect(g.goal).toBe("g");
  });

  it("is fast when the model output is a long run of braces", async () => {
    const { runModel } = await import("./models.ts");
    vi.mocked(runModel).mockResolvedValueOnce({ text: "{{".repeat(N / 2) } as never);
    const t0 = performance.now();
    await planTaskGraph("anything");
    expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
  });
});

describe("curtain stageGate trailing whitespace (alert 135)", () => {
  it("still restores the space that ended the held buffer", () => {
    const gate = stageGate();
    const out = gate.push("Hello there. ") + gate.flush();
    expect(out.length).toBeGreaterThan(0);
  });

  it("is fast on a chunk that is almost all spaces", () => {
    const gate = stageGate();
    const { ms } = timed(() => gate.push(`a${" ".repeat(N)}b`));
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe("scrub URL credential pattern (alert 134)", () => {
  it("still redacts a password in a connection string", () => {
    const s = scrub("postgres://admin:hunter22@db.example.com/app", {});
    expect(s).not.toContain("hunter22");
    expect(s).toContain("postgres://admin:");
    expect(s).toContain("@db.example.com");
    expect(carriesKnownCredential("see https://bob:secretpw@hook.example.com/x", {})).toBe(true);
    expect(carriesKnownCredential("https://example.com/no/creds", {})).toBe(false);
  });

  it("still redacts when the scheme is glued to preceding letters", () => {
    expect(scrub("xpostgres://u:pass1234@h/db", {})).not.toContain("pass1234");
  });

  it("is fast on a long run of scheme characters", () => {
    for (const evil of ["a".repeat(N), `${"a".repeat(N)}://u`, "a://".repeat(N / 4), `a://${"u".repeat(N)}:`]) {
      const s = timed(() => scrub(evil, {}));
      expect(s.ms).toBeLessThan(BUDGET_MS);
      const c = timed(() => carriesKnownCredential(evil, {}));
      expect(c.ms).toBeLessThan(BUDGET_MS);
    }
  });
});
