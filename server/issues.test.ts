import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _reset, breadcrumb, capture, issuesSummary, listIssues, redact } from "./issues.ts";

// The Sentry-discipline layer, strictly local. Proves: capture records a structured issue,
// recurring faults GROUP by fingerprint (count/first/last), secrets are REDACTED before storage,
// the store is bounded, and — the one that matters most — capture NEVER throws and never swallows
// its own errors silently.

beforeEach(() => _reset());
afterEach(() => _reset());

describe("capture + grouping", () => {
  it("records a caught error with host context + breadcrumbs", () => {
    breadcrumb("tool", "web_fetch", { url: "https://example.com" });
    const issue = capture(new Error("boom while fetching"));
    expect(issue).not.toBeNull();
    expect(issue!.message).toBe("boom while fetching");
    expect(issue!.count).toBe(1);
    expect(issue!.context.version).toBeDefined();
    expect(issue!.context.os).toMatch(/darwin|linux|win/i);
    expect(issue!.breadcrumbs.at(-1)?.msg).toBe("web_fetch");
  });

  it("groups the SAME fault: count rises, first stays, last advances — not a new issue", () => {
    capture(new Error("connect ECONNREFUSED 127.0.0.1:11434"));
    const second = capture(new Error("connect ECONNREFUSED 127.0.0.1:11434"));
    expect(listIssues()).toHaveLength(1);
    expect(second!.count).toBe(2);
    expect(second!.firstAt <= second!.lastAt).toBe(true);
  });

  it("groups across VOLATILE bits — different numbers/ids/paths, same fault → one group", () => {
    capture(new Error("failed to read /Users/a/docs/1.md"));
    capture(new Error("failed to read /Users/b/notes/2.md"));
    expect(listIssues()).toHaveLength(1); // normalised message → same fingerprint
    expect(listIssues()[0].count).toBe(2);
  });

  it("distinct faults stay distinct", () => {
    capture(new Error("disk full"));
    capture(new TypeError("x is not a function"));
    expect(listIssues()).toHaveLength(2);
  });
});

describe("redaction — a local issue log must not become a secrets log", () => {
  it("scrubs provider keys, bearer tokens, and long hex from strings", () => {
    expect(redact("key sk-abcdef0123456789abcdef here")).toContain("[redacted]");
    expect(redact("AIzaSyA1234567890abcdefghij1234567890xy")).toBe("[redacted]");
    expect(redact("Authorization: Bearer abcdef0123456789abcdef")).toContain("[redacted]");
    expect(redact("token=ghp_012345678901234567890123456789012345")).toContain("[redacted]");
    expect(redact("hi there")).toBe("hi there"); // ordinary text untouched
  });

  it("redacts breadcrumb data by sensitive KEY name and by value shape", () => {
    breadcrumb("tool", "save_key", { provider: "groq", apiKey: "gsk_abcdefghijklmnop0123", note: "AIzaSyA1234567890abcdefghij1234567890xy" });
    const issue = capture(new Error("save failed"));
    const crumb = issue!.breadcrumbs.at(-1)!;
    expect(crumb.data!.apiKey).toBe("[redacted]"); // sensitive key name → wholesale
    expect(String(crumb.data!.note)).toBe("[redacted]"); // secret-shaped value → scrubbed
    expect(crumb.data!.provider).toBe("groq"); // ordinary value kept
  });

  it("truncates very long strings so file contents can't bloat the log", () => {
    const long = "zebra words ".repeat(500); // non-hex, non-secret text
    expect(redact(long).length).toBeLessThan(260);
    expect(redact(long)).toContain("…[+");
  });
});

describe("robustness", () => {
  it("capture NEVER throws — bad inputs still produce an issue or a logged null, never an exception", () => {
    expect(() => capture(undefined)).not.toThrow();
    expect(() => capture("a plain string error")).not.toThrow();
    expect(() => capture({ weird: "object" })).not.toThrow();
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(() => capture(new Error("x"), circular)).not.toThrow();
  });

  it("issuesSummary reflects totals and clears", () => {
    expect(issuesSummary().clear).toBe(true);
    capture(new Error("a")); capture(new Error("a")); capture(new Error("b"));
    const s = issuesSummary();
    expect(s.distinct).toBe(2);
    expect(s.total).toBe(3);
    expect(s.clear).toBe(false);
  });

  it("breadcrumb ring stays bounded (no unbounded growth)", () => {
    for (let i = 0; i < 200; i++) breadcrumb("note", `step ${i}`);
    const issue = capture(new Error("after a flood"));
    expect(issue!.breadcrumbs.length).toBeLessThanOrEqual(40);
    expect(issue!.breadcrumbs.at(-1)?.msg).toBe("step 199"); // newest kept
  });
});
