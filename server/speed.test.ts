import { afterEach, describe, expect, it } from "vitest";
import { _reset, health, healthOrder, record, report, SINK_MS, sunk, TERMINAL } from "./speed.ts";

// The audit these tests exist to prevent a repeat of: on 2026-08-01, cerebras led the `fast` lane
// while answering 404 (retired model slug), hermes led `deep` and `code` while answering 402, and
// github models answered 410. Every turn opened with a failure and nothing in SAM noticed, because
// the cascade falls through silently. These pin the noticing.

afterEach(() => _reset());

const NOW = 1_800_000_000_000;

describe("what a failure MEANS", () => {
  it("sinks a brain whose model slug was retired (404), not one that's merely busy (429)", () => {
    record("cerebras", { ms: 400, ok: false, status: 404, now: NOW });
    record("groq", { ms: 400, ok: false, status: 429, now: NOW });
    expect(sunk("cerebras", NOW)).toBe(true);
    expect(sunk("groq", NOW)).toBe(false);
  });

  it("treats every terminal status the audit actually hit", () => {
    // 401 github (old endpoint) · 402 hermes and pollinations · 404 cerebras and openrouter ·
    // 410 github models retirement. All of them repeat identically on the next call.
    expect([...TERMINAL].sort()).toEqual([401, 402, 403, 404, 410]);
  });

  it("a timeout with no status is transient — a slow provider is not a gone one", () => {
    record("nvidia", { ms: 25000, ok: false, now: NOW });
    expect(sunk("nvidia", NOW)).toBe(false);
  });

  it("lets a sunk brain back up after the window, and instantly if it answers", () => {
    record("openrouter", { ms: 200, ok: false, status: 404, now: NOW });
    expect(sunk("openrouter", NOW + SINK_MS - 1)).toBe(true);
    expect(sunk("openrouter", NOW + SINK_MS + 1)).toBe(false);
    // Healing needs no file cleared and no restart: one good answer is enough. A re-issued key or
    // a fixed slug must not be punished for six hours.
    record("openrouter", { ms: 500, ok: true, now: NOW + 1000 });
    expect(sunk("openrouter", NOW + 1000)).toBe(false);
    expect(health("openrouter")?.reason).toBeUndefined();
  });
});

describe("latency memory", () => {
  it("averages the calls that WORKED, weighted towards the recent", () => {
    record("groq", { ms: 100, ok: true, now: NOW });
    record("groq", { ms: 200, ok: true, now: NOW });
    const h = health("groq")!;
    expect(h.ewmaMs).toBeGreaterThan(100);
    expect(h.ewmaMs).toBeLessThan(200);
    expect(h.calls).toBe(2);
    expect(h.ok).toBe(2);
  });

  it("does not let a failure's duration pollute the speed", () => {
    record("mistral", { ms: 300, ok: true, now: NOW });
    record("mistral", { ms: 24000, ok: false, status: 402, now: NOW });
    expect(health("mistral")?.ewmaMs).toBe(300);
  });
});

describe("ordering", () => {
  const pool = [{ id: "cerebras" }, { id: "groq" }, { id: "mistral" }];

  it("changes nothing until something has been measured", () => {
    expect(healthOrder(pool, NOW).map((p) => p.id)).toEqual(["cerebras", "groq", "mistral"]);
  });

  it("sinks the dead leader below the brains that answer", () => {
    record("cerebras", { ms: 400, ok: false, status: 404, now: NOW });
    record("groq", { ms: 115, ok: true, now: NOW });
    expect(healthOrder(pool, NOW).map((p) => p.id)).toEqual(["groq", "mistral", "cerebras"]);
  });

  it("keeps an untried brain ahead of a known-dead one", () => {
    // Never tried is not the same as tried and gone. A new brain deserves the chance the audit
    // gave cerebras — the fix there was a slug, and it came back at 422ms.
    record("cerebras", { ms: 400, ok: false, status: 410, now: NOW });
    expect(healthOrder(pool, NOW)[0].id).not.toBe("cerebras");
    expect(healthOrder(pool, NOW).map((p) => p.id).indexOf("mistral")).toBeLessThan(2);
  });

  it("demotes the measurably slow but keeps everyone within tolerance in place", () => {
    record("groq", { ms: 115, ok: true, now: NOW });
    record("cerebras", { ms: 422, ok: true, now: NOW });   // 3.7× the leader, but well under the floor
    record("mistral", { ms: 11000, ok: true, now: NOW });  // nvidia's real measured number
    expect(healthOrder(pool, NOW).map((p) => p.id)).toEqual(["cerebras", "groq", "mistral"]);
  });

  it("demotes a brain that keeps timing out, which no status would ever have caught", () => {
    // nvidia, live during the audit: two 30-second timeouts, no HTTP status, so nothing sank it
    // and nothing measured it — it would have kept its place at the front on a technicality.
    record("cerebras", { ms: 30000, ok: false, now: NOW });
    record("cerebras", { ms: 30000, ok: false, now: NOW });
    expect(sunk("cerebras", NOW)).toBe(false);   // not GONE — it may just be having a bad hour
    expect(healthOrder(pool, NOW).map((p) => p.id)).toEqual(["groq", "mistral", "cerebras"]);
    expect(report(NOW).find((r) => r.id === "cerebras")?.state).toContain("failing");
  });

  it("never drops a brain — a demoted one is still tried, just not first", () => {
    record("cerebras", { ms: 1, ok: false, status: 404, now: NOW });
    record("groq", { ms: 1, ok: false, status: 402, now: NOW });
    record("mistral", { ms: 1, ok: false, status: 401, now: NOW });
    expect(healthOrder(pool, NOW)).toHaveLength(3);
  });
});

describe("the report", () => {
  it("says which are ok, which are sunk and why, fastest first", () => {
    record("groq", { ms: 115, ok: true, now: NOW });
    record("cerebras", { ms: 400, ok: false, status: 404, now: NOW });
    const r = report(NOW);
    expect(r[0]).toMatchObject({ id: "groq", ms: 115, okRate: 100, state: "ok" });
    expect(r[r.length - 1]).toMatchObject({ id: "cerebras", state: "sunk (HTTP 404)" });
  });
});
