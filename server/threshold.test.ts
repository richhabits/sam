import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _reset as resetIssues, listIssues } from "./issues.ts";
import { buildSummary, crossIn, crossOut, sessions, type SessionSummary } from "./threshold.ts";

// The Threshold carries context across sessions, LOCALLY. Round-trip: cross out → cross in restores
// it. Storage is bounded. Secrets are redacted before persisting. And the cardinal test: a persist
// FAILURE surfaces loudly (Black Box + returned error) and NEVER silently reports success.

let dir = "";
const summary = (over: Partial<SessionSummary> = {}): SessionSummary =>
  ({ at: "2026-07-19T00:00:00.000Z", note: "did some work", openThreads: [], activity: [], ...over });

beforeEach(() => {
  resetIssues();
  dir = join(tmpdir(), `sam-threshold-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  process.env.VAULT_DIR = dir;
});
afterEach(() => {
  delete process.env.VAULT_DIR;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe("the Threshold — carryover round-trip", () => {
  it("cross out then cross in restores the last session", () => {
    expect(crossIn()).toBeNull();                                  // nothing yet
    const r = crossOut(summary({ at: "t1", note: "first" }));
    expect(r.ok).toBe(true);
    crossOut(summary({ at: "t2", note: "second", openThreads: ["1 tracked agent swarm(s)"] }));
    const back = crossIn();
    expect(back?.at).toBe("t2");                                   // the LATEST session
    expect(back?.note).toBe("second");
    expect(back?.openThreads).toEqual(["1 tracked agent swarm(s)"]);
  });

  it("storage is bounded — only the last 20 sessions are kept", () => {
    for (let i = 0; i < 25; i++) crossOut(summary({ at: `s${i}` }));
    const all = sessions();
    expect(all.length).toBe(20);
    expect(all[0].at).toBe("s5");                                  // s0..s4 dropped
    expect(all[19].at).toBe("s24");
  });
});

describe("the Threshold — buildSummary redacts secrets", () => {
  it("a secret-shaped note never reaches the persisted summary", () => {
    const s = buildSummary("saving key sk-abcdef0123456789abcdef now", "t1");
    expect(s.note).not.toContain("sk-abcdef0123456789abcdef");
    expect(s.note).toContain("[redacted]");
    crossOut(s);
    expect(readFileSync(join(dir, "threshold", "sessions.jsonl"), "utf8")).not.toContain("sk-abcdef0123456789abcdef");
  });
});

describe("the Threshold — a failed persist is LOUD, never silent context loss", () => {
  it("returns an error AND records to the Black Box when the write can't happen", () => {
    // Make the threshold dir path a FILE, so mkdir/write inside it throws.
    writeFileSync(join(dir, "threshold"), "i am a file, not a directory");
    const r = crossOut(summary());
    expect(r.ok).toBe(false);                                      // NOT reported saved
    if (!r.ok) expect(r.error.kind).toBe("persist-failed");
    expect(listIssues().some((i) => /threshold/i.test(JSON.stringify(i)))).toBe(true); // captured, not swallowed
    expect(existsSync(join(dir, "threshold", "sessions.jsonl"))).toBe(false);          // nothing partially written
  });
});
