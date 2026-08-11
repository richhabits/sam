import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Everything that reaches the outside world is injected, so nothing here runs a build,
// spends quota, or touches a provider. What is being proven is the loop's rules.
const exec = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("./exec.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exec.ts")>();
  return { ...actual, execInProject: exec.run };
});

import {
  buildUntilGreen, verifyFor, needsInstall, failureText, readProposal, noteFrom,
  describeOutcome, MAX_ITERATIONS,
} from "./loop.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "samyard-loop-"));
  exec.run.mockReset();
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const write = (rel: string, content: string) => {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
};
const read = (rel: string) => readFileSync(join(dir, rel), "utf8");
const ok = { code: 0, stdout: "", stderr: "", truncated: false };
const fail = (msg: string) => ({ code: 1, stdout: "", stderr: msg, truncated: false });

// step/spend/checkStop are the job's concerns, not the loop's rules, so they are ignored
// here — what these tests prove is when the loop writes, stops, and tells the truth.
const ignore = () => undefined;

function deps(propose: (s: string, p: string) => Promise<string>) {
  const logs: string[] = [];
  return {
    d: { propose, log: (l: string) => logs.push(l), step: ignore, spend: ignore, checkStop: ignore },
    logs,
  };
}

describe("choosing how to check the project", () => {
  it("has nothing to run for a plain HTML project", () => {
    write("index.html", "<h1>hi</h1>");
    expect(verifyFor(dir)).toBeNull();
  });
  it("prefers the build, since a project that will not compile cannot be tested", () => {
    write("package.json", JSON.stringify({ scripts: { test: "vitest", build: "vite build" } }));
    expect(verifyFor(dir)).toEqual({ command: "npm", args: ["run", "build"] });
  });
  it("falls to test, then typecheck", () => {
    write("package.json", JSON.stringify({ scripts: { test: "vitest" } }));
    expect(verifyFor(dir)?.args).toEqual(["run", "test"]);
  });
  it("treats an unreadable manifest the same as none", () => {
    write("package.json", "{ not json");
    expect(verifyFor(dir)).toBeNull();
  });
  it("knows when dependencies are missing", () => {
    write("package.json", JSON.stringify({ scripts: { build: "x" } }));
    expect(needsInstall(dir)).toBe(true);
    mkdirSync(join(dir, "node_modules"));
    expect(needsInstall(dir)).toBe(false);
  });
});

describe("what gets sent back as the error", () => {
  it("keeps the TAIL, because a build prints its failure last", () => {
    const long = `${"progress\n".repeat(2000)}THE REAL ERROR`;
    const out = failureText({ ...fail(long) }, 100);
    expect(out).toContain("THE REAL ERROR");
    expect(out.length).toBeLessThan(200);
  });
});

describe("reading a proposal", () => {
  const offered = [{ path: "a.js", content: "const x = 1;\n" }];

  it("applies a pinpoint edit", () => {
    const out = readProposal(JSON.stringify({ edits: [{ path: "a.js", find: "const x = 1;", replace: "const x = 2;" }] }), offered);
    expect(out).toEqual([{ path: "a.js", content: "const x = 2;\n" }]);
  });
  it("refuses a pinpoint edit against a file that was never shown", () => {
    expect(readProposal(JSON.stringify({ edits: [{ path: "ghost.js", find: "a", replace: "b" }] }), offered)).toBeNull();
  });
  it("refuses a find that does not match, rather than half-applying", () => {
    expect(readProposal(JSON.stringify({ edits: [{ path: "a.js", find: "nowhere", replace: "b" }] }), offered)).toBeNull();
  });
  it("takes whole files too, and a pinpoint edit wins over a whole file for the same path", () => {
    const out = readProposal(JSON.stringify({
      edits: [{ path: "a.js", find: "const x = 1;", replace: "const x = 9;" }],
      files: [{ path: "a.js", content: "WHOLE" }, { path: "b.js", content: "new file" }],
    }), offered);
    expect(out).toEqual([{ path: "a.js", content: "const x = 9;\n" }, { path: "b.js", content: "new file" }]);
  });
  it("returns null for prose", () => {
    expect(readProposal("I'd be happy to help!", offered)).toBeNull();
  });
  it("reads the note when there is one", () => {
    expect(noteFrom(JSON.stringify({ note: "renamed the export" }))).toBe("renamed the export");
    expect(noteFrom("not json")).toBe("");
  });
});

describe("the loop", () => {
  const pkg = (scripts: Record<string, string>) => write("package.json", JSON.stringify({ scripts }));

  it("is honest that a project with nothing to run was NOT verified", async () => {
    write("index.html", "<h1>hi</h1>");
    const { d } = deps(async () => "");
    const out = await buildUntilGreen(dir, "make a page", d);
    expect(out.ok).toBe(false);
    expect(out.stopped).toBe("no-verify");
    expect(describeOutcome(out)).toContain("NOT verified");
  });

  it("passes first time without asking the model for anything", async () => {
    pkg({ build: "x" });
    mkdirSync(join(dir, "node_modules"));
    exec.run.mockResolvedValue(ok);
    const propose = vi.fn();
    const { d } = deps(propose as any);
    const out = await buildUntilGreen(dir, "build it", d);
    expect(out.ok).toBe(true);
    expect(out.stopped).toBe("verified");
    expect(propose).not.toHaveBeenCalled();
  });

  it("reads the error, fixes it, and confirms by running again", async () => {
    pkg({ build: "x" });
    mkdirSync(join(dir, "node_modules"));
    write("a.js", "const x = 1;\n");
    exec.run.mockResolvedValueOnce(fail("a.js: x should be 2")).mockResolvedValueOnce(ok);
    const { d, logs } = deps(async () => JSON.stringify({
      edits: [{ path: "a.js", find: "const x = 1;", replace: "const x = 2;" }], note: "set x to 2",
    }));
    const out = await buildUntilGreen(dir, "make x be 2", d);
    expect(out.ok).toBe(true);
    expect(out.iterations).toBe(1);
    expect(read("a.js")).toBe("const x = 2;\n");
    expect(out.diffs).toHaveLength(1);
    expect(logs.some((l) => l.includes("set x to 2"))).toBe(true);
  });

  it("stops at the ceiling and reports what still fails, never a sentence that reads like success", async () => {
    pkg({ build: "x" });
    mkdirSync(join(dir, "node_modules"));
    write("a.js", "let n = 0;\n");
    exec.run.mockResolvedValue(fail("STILL BROKEN"));
    let n = 0;
    const { d } = deps(async () => JSON.stringify({ files: [{ path: "a.js", content: `let n = ${++n};\n` }] }));
    const out = await buildUntilGreen(dir, "fix it", d);
    expect(out.ok).toBe(false);
    expect(out.stopped).toBe("exhausted");
    expect(exec.run).toHaveBeenCalledTimes(MAX_ITERATIONS);
    expect(describeOutcome(out)).toContain("STILL BROKEN");
    expect(describeOutcome(out)).toMatch(/still failing/i);
  });

  it("stops when a fix changes nothing on disk, rather than buying another round of the same answer", async () => {
    pkg({ build: "x" });
    mkdirSync(join(dir, "node_modules"));
    write("a.js", "const x = 1;\n");
    exec.run.mockResolvedValue(fail("broken"));
    // The model keeps proposing exactly what is already there.
    const { d, logs } = deps(async () => JSON.stringify({ files: [{ path: "a.js", content: "const x = 1;\n" }] }));
    const out = await buildUntilGreen(dir, "fix it", d);
    expect(out.stopped).toBe("stalled");
    expect(exec.run).toHaveBeenCalledTimes(1);
    expect(logs.some((l) => l.includes("returned the files unchanged"))).toBe(true);
  });

  it("stops when the proposal cannot be used", async () => {
    pkg({ build: "x" });
    mkdirSync(join(dir, "node_modules"));
    write("a.js", "const x = 1;\n");
    exec.run.mockResolvedValue(fail("broken"));
    const { d, logs } = deps(async () => "I'd be happy to help with that!");
    const out = await buildUntilGreen(dir, "fix it", d);
    expect(out.ok).toBe(false);
    expect(logs.some((l) => l.includes("could not be used"))).toBe(true);
  });

  it("installs dependencies when they are missing, before running anything", async () => {
    pkg({ build: "x" });
    exec.run.mockResolvedValueOnce(ok).mockResolvedValueOnce(ok);
    const { d } = deps(async () => "");
    await buildUntilGreen(dir, "build", d);
    expect(exec.run.mock.calls[0][1]).toBe("npm");
    expect(exec.run.mock.calls[0][2]).toContain("install");
  });

  it("records a diff for every write, holding the bytes that were there before", async () => {
    pkg({ build: "x" });
    mkdirSync(join(dir, "node_modules"));
    write("a.js", "old\n");
    exec.run.mockResolvedValueOnce(fail("broken")).mockResolvedValueOnce(ok);
    const { d } = deps(async () => JSON.stringify({ files: [{ path: "a.js", content: "new\n" }] }));
    const out = await buildUntilGreen(dir, "fix", d);
    expect(out.diffs[0].before).toBe("old\n");
    expect(out.diffs[0].path).toBe("a.js");
  });

  it("never lets the model rewrite SAM's own record of the project", async () => {
    pkg({ build: "x" });
    mkdirSync(join(dir, "node_modules"));
    write("project.sam.json", '{"slug":"real"}');
    write("a.js", "const x = 1;\n");
    exec.run.mockResolvedValue(fail("broken"));
    const { d } = deps(async () => JSON.stringify({ files: [{ path: "project.sam.json", content: '{"slug":"hijacked"}' }] }));
    await buildUntilGreen(dir, "fix", d);
    expect(read("project.sam.json")).toBe('{"slug":"real"}');
  });
});

// The job row keeps the FIRST tier anyone gives it, so a tier named before the model runs is
// the one that sticks and the truth never lands. This loop used to pass "free" on the way IN
// — stamping cloud attribution onto work that ran wholly on-device. Whoever actually runs the
// model is the only party that knows what served it, so the loop must name no tier at all.
describe("the loop never invents a tier", () => {
  const pkg = (scripts: Record<string, string>) => write("package.json", JSON.stringify({ scripts }));

  it("reports spend without claiming which tier served it", async () => {
    pkg({ test: "x" });
    mkdirSync(join(dir, "node_modules"));
    // fail once so the model is actually consulted, then pass.
    exec.run.mockResolvedValueOnce(fail("boom")).mockResolvedValue(ok);

    const spends: Array<{ tokens: number; tier?: string }> = [];
    const logs: string[] = [];
    await buildUntilGreen(dir, "fix it", {
      propose: async () => JSON.stringify({ files: [{ path: "a.txt", content: "fixed" }] }),
      log: (l: string) => logs.push(l),
      step: () => undefined,
      spend: (tokens: number, tier?: string) => { spends.push({ tokens, tier }); },
      checkStop: () => undefined,
    });

    expect(spends.length).toBeGreaterThan(0);          // it did report spend
    expect(spends.every((s) => s.tier === undefined)).toBe(true);
    expect(spends.some((s) => s.tier === "free")).toBe(false);   // the exact bug
  });
});

describe("a dropped pinpoint edit is reported, not silently swallowed", () => {
  // Both refusal paths in readProposal used to `continue` in silence. A model mis-quoting
  // whitespace in `find` is the commonest way an edit fails, and the loop would then rebuild
  // unchanged code, hit the same error, and spend another bounded attempt on a proposal that
  // never landed — with nothing in the log saying so.
  const offered = [{ path: "a.js", content: "const x = 1;\n" }];

  it("says WHY when the passage is not in the file", () => {
    const skips: string[] = [];
    const out = readProposal(
      JSON.stringify({ edits: [{ path: "a.js", find: "const x = 999;", replace: "const x = 2;" }] }),
      offered,
      (p, why) => skips.push(`${p}: ${why}`),
    );
    expect(out).toBeNull();                       // nothing usable came back…
    expect(skips).toHaveLength(1);                // …and the reason was reported
    expect(skips[0]).toContain("a.js");
    expect(skips[0]).toMatch(/not found/);
  });

  it("says WHY when the edit names a file that was never shown", () => {
    const skips: string[] = [];
    readProposal(
      JSON.stringify({ edits: [{ path: "ghost.js", find: "a", replace: "b" }] }),
      offered,
      (p, why) => skips.push(`${p}: ${why}`),
    );
    expect(skips[0]).toContain("ghost.js");
    expect(skips[0]).toMatch(/shown/);
  });

  it("reports an ambiguous edit rather than guessing which match to take", () => {
    const twice = [{ path: "b.js", content: "let a = 1;\nlet a = 1;\n" }];
    const skips: string[] = [];
    readProposal(
      JSON.stringify({ edits: [{ path: "b.js", find: "let a = 1;", replace: "let a = 2;" }] }),
      twice,
      (p, why) => skips.push(why),
    );
    expect(skips[0]).toMatch(/matches 2 places/);
  });

  it("stays silent when every edit applies", () => {
    const skips: string[] = [];
    const out = readProposal(
      JSON.stringify({ edits: [{ path: "a.js", find: "const x = 1;", replace: "const x = 2;" }] }),
      offered,
      (p, why) => skips.push(why),
    );
    expect(out).toEqual([{ path: "a.js", content: "const x = 2;\n" }]);
    expect(skips).toEqual([]);
  });
});
